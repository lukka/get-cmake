// Copyright (c) 2022-2024 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as process from 'process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as rc from '../src/releases-collector'
import * as semver from 'semver';
import { HttpClient } from '@actions/http-client';

const { Octokit } = require("@octokit/core");
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

// 1 hour in milliseconds.
jest.setTimeout(60 * 60 * 1000)

const httpClient = new HttpClient('get-cmake-catalog-generator/1.0');

async function fetchText(url: string): Promise<string | null> {
    try {
        const response = await httpClient.get(url);
        if (response.message.statusCode !== 200) {
            return null;
        }
        return await response.readBody();
    } catch (err) {
        return null;
    }
}

/** Parse a SHA-256 manifest line and return [filename, hash] or null. */
function parseSha256Line(line: string): [string, string] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return null;
    const hash = parts[0].toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    return [parts[1], hash];
}

function writeLatestToFile(map: rc.MostRecentReleases, releaseName: string, platform: string, filename: string): void {
    const value = map.get(releaseName)?.get(platform)?.mostRecentVersion?.version;
    if (!value)
        throw new Error(`Cannot get the '${releaseName}' for ${platform}`);
    fs.writeFileSync(filename, value);
}

test('generate catalog of all CMake and Ninja releases ...', async () => {
    console.log('generate release catalog ...');
    if (!process.env['GITHUB_TOKEN']) {
        const result = dotenv.config();
        if (result.error) {
            throw result.error;
        }
    }

    const MyOctokit = Octokit.plugin(throttling, retry, restEndpointMethods, paginateRest);
    const octokit = new MyOctokit({
        throttle: {
            onRateLimit: (retryAfter: any, options: any, octokit: any, retryCount: any) => {
                octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`);

                if (retryCount < 5) {
                    octokit.log.info(`Retrying after ${retryAfter} seconds!`);
                    return true;
                }
            },
            onSecondaryRateLimit: (retryAfter: any, options: any, octokit: any) => {
                octokit.log.warn(`SecondaryRateLimit detected for request ${options.method} ${options.url}`);
                return true;
            },
        }
    });
    // TODO: if needed, usage of a TOKEN could be enabled by passing the following 
    // instance to the MyOctokit() ctor: { auth: process.env.GITHUB_TOKEN! });
    if (!octokit) {
        throw new Error('cannot get Octokit client');
    }

    const cmakeReleasesMap: rc.CatalogType = {};
    const cmakeMostRecentRelease: rc.MostRecentReleases = new Map();
    const cmakeCollector: rc.ReleasesCollector = new rc.ReleasesCollector(cmakeReleasesMap, cmakeMostRecentRelease, rc.CMakeFilters.allFilters);

    const ninjaReleasesMap: rc.CatalogType = {};
    const ninjaMostRecentRelease: rc.MostRecentReleases = new Map();
    const ninjaCollector: rc.ReleasesCollector = new rc.ReleasesCollector(ninjaReleasesMap, ninjaMostRecentRelease, rc.NinjaFilters.allFilters);
    await octokit.paginate('GET /repos/Kitware/CMake/releases', {
        owner: 'Kitware',
        repo: 'CMake',
        per_page: 100,
    },
        (response: any) => {
            for (const rel of response.data) {
                try {
                    const assets = rel.assets as rc.Asset[];
                    assets.forEach((t) => t.tag_name = rel.tag_name);
                    cmakeCollector.track(assets);
                }
                catch (err: any) {
                    console.log("Warning: " + err);
                }
            }
        }).catch((err: any) => {
            console.log(`Failure during HTTP download and parsing of CMake releases: ${err as Error}`);
            throw err;
        });

    console.log(`Found ${Object.keys(cmakeReleasesMap).length} releases: `);
    for (const relVersion in cmakeReleasesMap) {
        console.log(`${relVersion}: ${JSON.stringify(cmakeReleasesMap[relVersion])}\n`);
    }

    // Fetch SHA-256 manifests for all versioned CMake releases and populate the catalog.
    // Kitware publishes a SHA-256 manifest for every CMake release at:
    //   https://github.com/Kitware/CMake/releases/download/vX.Y.Z/cmake-X.Y.Z-SHA-256.txt
    console.log('Fetching SHA-256 checksums for CMake releases...');
    const versionedCmakeKeys = Object.keys(cmakeReleasesMap).filter(k => semver.valid(k));
    for (const versionKey of versionedCmakeKeys) {
        const sha256Url = `https://github.com/Kitware/CMake/releases/download/v${versionKey}/cmake-${versionKey}-SHA-256.txt`;
        const text = await fetchText(sha256Url);
        if (text) {
            for (const line of text.split('\n')) {
                const parsed = parseSha256Line(line);
                if (!parsed) continue;
                const [fileName, hash] = parsed;
                for (const platform of Object.keys(cmakeReleasesMap[versionKey])) {
                    const pkg = cmakeReleasesMap[versionKey][platform];
                    if (pkg.fileName === fileName) {
                        pkg.sha256 = hash;
                    }
                }
            }
            console.log(`  SHA-256 fetched for CMake ${versionKey}`);
        } else {
            console.log(`  Warning: Could not fetch SHA-256 manifest for CMake ${versionKey}`);
        }
    }

    // Generate the CMake catalog file.
    fs.writeFileSync(
        path.join("./src", rc.ReleasesCatalogFileName), "export const cmakeCatalog = " + JSON.stringify(cmakeReleasesMap));

    writeLatestToFile(cmakeMostRecentRelease, 'latest', process.platform, ".latest_cmake_version");
    writeLatestToFile(cmakeMostRecentRelease, 'latestrc', process.platform, ".latestrc_cmake_version");

    // Map from Ninja package fileName to its SHA-256 download URL.
    const ninjaSha256UrlMap: Map<string, string> = new Map();

    for (const repoPath of ['/repos/Kitware/ninja/releases', '/repos/ninja-build/ninja/releases']) {
        await octokit.paginate(`GET ${repoPath}`, {
            owner: repoPath.split('/')[2],
            repo: 'ninja',
            per_page: 30,
        },
            (response: any) => {
                for (const rel of response.data) {
                    try {
                        const assets = rel.assets as rc.Asset[];
                        assets.forEach((t) => t.tag_name = rel.tag_name);
                        ninjaCollector.track(assets);

                        // Collect SHA-256 file asset URLs for Ninja packages.
                        for (const asset of assets) {
                            if (asset.name.toLowerCase().endsWith('.sha256')) {
                                const pkgName = asset.name.slice(0, -'.sha256'.length);
                                ninjaSha256UrlMap.set(pkgName, asset.browser_download_url);
                            }
                        }
                    }
                    catch (err: any) {
                        console.log("Warning: " + err);
                    }
                }
            }).catch((err: any) => {
                console.log(`Failure during HTTP download and parsing of Ninja releases: ${err as Error}`);
                throw err;
            });
    };

    // Fetch SHA-256 content for each collected Ninja package URL.
    console.log('Fetching SHA-256 checksums for Ninja releases...');
    const ninjaSha256Map: Map<string, string> = new Map();
    for (const [fileName, sha256Url] of ninjaSha256UrlMap) {
        const text = await fetchText(sha256Url);
        if (text) {
            const parts = text.trim().split(/\s+/);
            const hash = parts[0].toLowerCase();
            if (/^[0-9a-f]{64}$/.test(hash)) {
                ninjaSha256Map.set(fileName, hash);
                console.log(`  SHA-256 fetched for Ninja package '${fileName}'`);
            }
        } else {
            console.log(`  Warning: Could not fetch SHA-256 for Ninja package '${fileName}'`);
        }
    }

    // Update Ninja catalog entries with SHA-256 values.
    for (const versionKey of Object.keys(ninjaReleasesMap)) {
        for (const platform of Object.keys(ninjaReleasesMap[versionKey])) {
            const pkg = ninjaReleasesMap[versionKey][platform];
            if (pkg.fileName) {
                const sha256 = ninjaSha256Map.get(pkg.fileName);
                if (sha256) pkg.sha256 = sha256;
            }
        }
    }

    console.log(`Found ${Object.keys(ninjaReleasesMap).length} releases: `);
    for (const relVersion in ninjaReleasesMap) {
        console.log(`${relVersion}: ${JSON.stringify(ninjaReleasesMap[relVersion])}\n`);
    }

    // Generate the Ninja catalog file.
    fs.appendFileSync(
        path.join("./src", rc.ReleasesCatalogFileName), "\n\n export const ninjaCatalog = " + JSON.stringify(ninjaReleasesMap));

    writeLatestToFile(ninjaMostRecentRelease, 'latest', process.platform, ".latest_ninja_version");
});

