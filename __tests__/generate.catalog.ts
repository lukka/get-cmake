// Copyright (c) 2022 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as process from 'process';
import * as dotenv from 'dotenv';
import * as semver from 'semver';
import * as fs from 'fs';
import * as path from 'path';
import { ReleaseFilter, ReleasesCatalogFileName, CatalogType } from '../src/shared'

const { Octokit } = require("@octokit/core");
import { paginateRest } from "@octokit/plugin-paginate-rest";
jest.setTimeout(60 * 1000)


test.only('generate catalog of all CMake releases ...', async () => {
    console.log('generate release db ...');
    if (!process.env.GITHUB_TOKEN) {
        const result = dotenv.config();
        if (result.error) {
            throw result.error;
        }
    }

    const releasesMap: CatalogType = {};
    const MyOctokit = Octokit.plugin(paginateRest);
    const octokit = new MyOctokit();
    // TODO: if needed, usage of a TOKEN could be enabled by passing the following 
    // instance to the MyOctokit() ctor: { auth: process.env.GITHUB_TOKEN! });
    if (!octokit) {
        throw new Error('cannot get Octokit client');
    }
    await octokit.paginate('GET /repos/Kitware/CMake/releases', {
        owner: 'Kitware',
        repo: 'CMake',
        per_page: 30,
    },
        (response: any) => {
            let releaseHit = false;
            for (const rel of response.data) {
                try {
                    if (rel.prerelase)
                        continue;
                    const linuxFilters: ReleaseFilter[] = [{
                        binPath: 'bin/',
                        dropSuffix: ".tar.gz",
                        suffix: "linux-x86_64.tar.gz",
                        platform: "linux",
                    }];
                    const windowsFilters: ReleaseFilter[] = [{
                        binPath: 'bin/',
                        dropSuffix: ".zip",
                        suffix: "windows-x86_64.zip",
                        platform: "win32",
                    }, {
                        binPath: 'bin/',
                        dropSuffix: ".zip",
                        suffix: "win64-x64.zip",
                        platform: "win32",
                    }, {
                        binPath: 'bin/',
                        dropSuffix: ".zip",
                        suffix: "win32-x86.zip",
                        platform: "win32",
                    }];
                    const macosFilters: ReleaseFilter[] = [{
                        binPath: "CMake.app/Contents/bin/",
                        dropSuffix: '.tar.gz',
                        suffix: "macos-universal.tar.gz",
                        platform: "darwin",
                    }, {
                        binPath: "CMake.app/Contents/bin/",
                        dropSuffix: '.tar.gz',
                        suffix: "Darwin-x86_64.tar.gz",
                        platform: "darwin",
                    }];
                    const allFilters: ReleaseFilter[] = linuxFilters.concat(macosFilters.concat(windowsFilters));
                    for (const asset of rel.assets) {
                        releaseHit = false;

                        for (const filter of allFilters) {
                            if (asset.name.trim().toLowerCase().endsWith(filter.suffix.toLowerCase())) {
                                try {
                                    const version = semver.parse(rel.tag_name);
                                    if (version && (version.prerelease.length === 0)) {
                                        let plats = releasesMap[`${version.major}.${version.minor}.${version.patch}`];
                                        if (!plats)
                                            releasesMap[`${version.major}.${version.minor}.${version.patch}`] = {};
                                        releasesMap[`${version.major}.${version.minor}.${version.patch}`][filter.platform] =
                                        {
                                            url: asset.browser_download_url,
                                            fileName: asset.name,
                                            binPath: filter.binPath,
                                            dropSuffix: filter.dropSuffix,
                                        };
                                        releaseHit = true;
                                    }
                                }
                                catch (err: any) {
                                    console.log("Warning: " + err);
                                    continue;
                                }
                            }
                        }

                        if (releaseHit === false) {
                            console.log(`Skipping ${asset.name}`);
                        }
                    }
                }
                catch (err: any) {
                    console.log("Warning: " + err);
                }
            }

        }).catch((err: any) => {
            console.log(`Failure during HTTP download and parsing of CMake releases: ${err as Error}`);
            throw err;
        });

    console.log(`Found ${Object.keys(releasesMap).length} releases: `);
    for (const relVersion in releasesMap) {
        console.log(`${relVersion}: ${JSON.stringify(releasesMap[relVersion])}\n`);
    }

    // Generate the catalog file.
    fs.writeFileSync(
        path.join("./src", ReleasesCatalogFileName), "export const cmakeCatalog = " + JSON.stringify(releasesMap));
});
