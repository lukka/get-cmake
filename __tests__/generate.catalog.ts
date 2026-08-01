// Copyright (c) 2022-2024 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as process from 'process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { pipeline } from 'stream/promises';
import * as rc from '../src/releases-collector'
import * as semver from 'semver';
import { HttpClient } from '@actions/http-client';
// The catalog being regenerated. It is read before being overwritten, so that the
// SHA-256 digests already computed by a previous run can be carried over instead of
// being downloaded again.
import * as previousCatalog from '../src/releases-catalog';

const { Octokit } = require("@octokit/core");
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

// 1 hour in milliseconds.
jest.setTimeout(60 * 60 * 1000)

const httpClient = new HttpClient('get-cmake-catalog-generator/1.0');

// Number of retries upon a transient HTTP failure.
const maxRetries = 3;

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Fetch the content of 'url' as text.
 * @returns the body, or null when the resource does not exist (HTTP 404).
 * @throws when the resource cannot be fetched for any other reason, e.g. a transient
 * network failure: silently dropping those would let the generator emit a catalog
 * missing the digests the action requires at run time.
 */
async function fetchText(url: string): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
        try {
            const response = await httpClient.get(url);
            const statusCode = response.message.statusCode;
            const body = await response.readBody();
            if (statusCode === 200)
                return body;
            if (statusCode === 404)
                return null;
            throw new Error(`GET '${url}' failed with status code ${statusCode}.`);
        } catch (err) {
            if (attempt >= maxRetries)
                throw err;
            console.log(`  Retrying '${url}' after failure: ${err}`);
            await delay(1000 * (2 ** attempt));
        }
    }
}

/**
 * Download the artifact at 'url' and compute its SHA-256. This is the fallback for the
 * legacy releases that publish neither a checksum manifest nor a GitHub asset digest.
 * @returns the digest, or null when the artifact does not exist anymore (HTTP 404):
 * a few assets of the oldest releases have been lost by the GitHub storage.
 */
async function computeSha256ByDownloading(url: string): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
        try {
            const response = await httpClient.get(url);
            if (response.message.statusCode !== 200) {
                await response.readBody();
                if (response.message.statusCode === 404)
                    return null;
                throw new Error(`GET '${url}' failed with status code ${response.message.statusCode}.`);
            }
            const hasher = crypto.createHash('sha256');
            await pipeline(response.message, hasher);
            return hasher.digest('hex');
        } catch (err) {
            if (attempt >= maxRetries)
                throw err;
            console.log(`  Retrying '${url}' after failure: ${err}`);
            await delay(1000 * (2 ** attempt));
        }
    }
}

/** Index the SHA-256 digests of an already generated catalog by download URL. */
function indexDigestsByUrl(...catalogs: rc.CatalogType[]): Map<string, string> {
    const digests = new Map<string, string>();
    for (const theCatalog of catalogs) {
        for (const versionKey of Object.keys(theCatalog)) {
            for (const platform of Object.keys(theCatalog[versionKey])) {
                const pkg = theCatalog[versionKey][platform];
                if (pkg.sha256)
                    digests.set(pkg.url, pkg.sha256);
            }
        }
    }
    return digests;
}

/**
 * Ensure every package of the catalog carries a SHA-256 digest, since the action refuses
 * to extract an archive it cannot verify. Missing digests are carried over from the
 * previous catalog when the download URL is unchanged, and computed by downloading the
 * artifact otherwise. The packages whose artifact does not exist anymore are dropped:
 * they cannot be installed regardless of the verification.
 * @throws when a digest cannot be established for a package that is still downloadable.
 */
async function ensureAllSha256(
    theCatalog: rc.CatalogType, toolName: string, knownDigests: Map<string, string>): Promise<void> {
    const unavailableUrls = new Set<string>();
    for (const versionKey of Object.keys(theCatalog)) {
        for (const platform of Object.keys(theCatalog[versionKey])) {
            // Note: the 'latest'/'latestrc' entries share the very same PackageInfo instance
            // of the version they point to, hence they are filled in by this same loop.
            const pkg = theCatalog[versionKey][platform];
            if (pkg.sha256 || unavailableUrls.has(pkg.url))
                continue;
            const knownDigest = knownDigests.get(pkg.url);
            if (knownDigest) {
                pkg.sha256 = knownDigest;
                console.log(`  SHA-256 of ${toolName} ${versionKey} (${platform}) carried over from the previous catalog.`);
                continue;
            }
            console.log(`  Computing SHA-256 of ${toolName} ${versionKey} (${platform}) by downloading '${pkg.url}' ...`);
            const sha256 = await computeSha256ByDownloading(pkg.url);
            if (!sha256)
                unavailableUrls.add(pkg.url);
            else
                pkg.sha256 = sha256;
        }
    }

    for (const versionKey of Object.keys(theCatalog)) {
        for (const platform of Object.keys(theCatalog[versionKey])) {
            const pkg = theCatalog[versionKey][platform];
            if (unavailableUrls.has(pkg.url)) {
                console.log(`  Warning: dropping ${toolName} ${versionKey} (${platform}), '${pkg.url}' does not exist anymore.`);
                delete theCatalog[versionKey][platform];
            } else if (!pkg.sha256) {
                throw new Error(`Missing SHA-256 digest for ${toolName} ${versionKey} (${platform}): '${pkg.url}'.`);
            }
        }
        if (Object.keys(theCatalog[versionKey]).length === 0)
            delete theCatalog[versionKey];
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
    // In binary mode the file name is prefixed by '*', e.g. "<hash> *<filename>".
    return [parts[1].replace(/^\*/, ''), hash];
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

    // Snapshot the digests of the catalog being regenerated: the releases whose download
    // URL is unchanged do not need to be downloaded again to recompute their digest.
    const knownDigests = indexDigestsByUrl(
        previousCatalog.cmakeCatalog as rc.CatalogType, previousCatalog.ninjaCatalog as rc.CatalogType);
    console.log(`Known SHA-256 digests from the previous catalog: ${knownDigests.size}.`);

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
    // Releases predating the introduction of those manifests are handled by
    // ensureAllSha256() below.
    console.log('Fetching SHA-256 checksums for CMake releases...');
    const versionedCmakeKeys = Object.keys(cmakeReleasesMap).filter(k => semver.valid(k));
    for (const versionKey of versionedCmakeKeys) {
        const sha256Url = `https://github.com/Kitware/CMake/releases/download/v${versionKey}/cmake-${versionKey}-SHA-256.txt`;
        const text = await fetchText(sha256Url);
        if (!text) {
            console.log(`  No SHA-256 manifest published for CMake ${versionKey}.`);
            continue;
        }

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
        // Validate that every tracked package filename was found in the manifest: a
        // published manifest that does not list one of the assets is suspicious.
        for (const platform of Object.keys(cmakeReleasesMap[versionKey])) {
            const pkg = cmakeReleasesMap[versionKey][platform];
            if (!pkg.sha256) {
                throw new Error(
                    `SHA-256 manifest for CMake ${versionKey} did not contain an entry for '${pkg.fileName}' (platform: ${platform})`
                );
            }
        }
        console.log(`  SHA-256 fetched for CMake ${versionKey}`);
    }

    await ensureAllSha256(cmakeReleasesMap, 'CMake', knownDigests);

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
            console.log(`  No SHA-256 file published for Ninja package '${fileName}'`);
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

    await ensureAllSha256(ninjaReleasesMap, 'Ninja', knownDigests);

    console.log(`Found ${Object.keys(ninjaReleasesMap).length} releases: `);
    for (const relVersion in ninjaReleasesMap) {
        console.log(`${relVersion}: ${JSON.stringify(ninjaReleasesMap[relVersion])}\n`);
    }

    // Generate the Ninja catalog file.
    fs.appendFileSync(
        path.join("./src", rc.ReleasesCatalogFileName), "\n\n export const ninjaCatalog = " + JSON.stringify(ninjaReleasesMap));

    writeLatestToFile(ninjaMostRecentRelease, 'latest', process.platform, ".latest_ninja_version");
});

