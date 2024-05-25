// Copyright (c) 2022-2024 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as process from 'process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as rc from '../src/releases-collector'

const { Octokit } = require("@octokit/core");
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

// 1 hour in milliseconds.
jest.setTimeout(60 * 60 * 1000)

function writeLatestToFile(map: rc.MostRecentReleases, releaseName: string, platform: string, filename: string): void {
    const value = map.get(releaseName)?.get(platform)?.mostRecentVersion?.version;
    if (!value)
        throw new Error(`Cannot get the '${releaseName}' for ${platform}`);
    fs.writeFileSync(filename, value);
}

test.only('generate catalog of all CMake and Ninja releases ...', async () => {
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

    // Generate the CMake catalog file.
    fs.writeFileSync(
        path.join("./src", rc.ReleasesCatalogFileName), "export const cmakeCatalog = " + JSON.stringify(cmakeReleasesMap));

    writeLatestToFile(cmakeMostRecentRelease, 'latest', process.platform, ".latest_cmake_version");
    writeLatestToFile(cmakeMostRecentRelease, 'latestrc', process.platform, ".latestrc_cmake_version");

    for (const path of ['/repos/Kitware/ninja/releases', '/repos/ninja-build/ninja/releases']) {
        await octokit.paginate(`GET ${path}`, {
            owner: path.split('/')[2],
            repo: 'ninja',
            per_page: 30,
        },
            (response: any) => {
                for (const rel of response.data) {
                    try {
                        const assets = rel.assets as rc.Asset[];
                        assets.forEach((t) => t.tag_name = rel.tag_name);
                        ninjaCollector.track(assets);
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

    console.log(`Found ${Object.keys(ninjaReleasesMap).length} releases: `);
    for (const relVersion in ninjaReleasesMap) {
        console.log(`${relVersion}: ${JSON.stringify(ninjaReleasesMap[relVersion])}\n`);
    }

    // Generate the Ninja catalog file.
    fs.appendFileSync(
        path.join("./src", rc.ReleasesCatalogFileName), "\n\n export const ninjaCatalog = " + JSON.stringify(ninjaReleasesMap));

    writeLatestToFile(ninjaMostRecentRelease, 'latest', process.platform, ".latest_ninja_version");
});
