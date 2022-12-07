// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as os from 'os';
import * as getcmake from '../src/get-cmake';
import * as cache from '@actions/cache';
import * as toolcache from '@actions/tool-cache';
import * as core from '@actions/core';
import { InputOptions } from '@actions/core';

// 30 minutes
jest.setTimeout(30 * 60 * 1000)

jest.spyOn(cache, 'saveCache').mockImplementation(() =>
    Promise.resolve(0)
);

jest.spyOn(cache, 'restoreCache').mockImplementation(() =>
    Promise.resolve(undefined)
);

jest.spyOn(core, 'getInput').mockImplementation((arg: string, options: InputOptions | undefined): string => {
    if (arg === "cmakeVersion")
        return process.env["CUSTOM_CMAKE_VERSION"] || "";
    else
        return "";
});

var coreSetFailed = jest.spyOn(core, 'setFailed');
var coreError = jest.spyOn(core, 'error');
var toolsCacheDir = jest.spyOn(toolcache, 'cacheDir');

test('testing get-cmake action success with default cmake', async () => {
    process.env.RUNNER_TEMP = os.tmpdir();
    delete process.env.CUSTOM_CMAKE_VERSION;
    await getcmake.main();
    expect(coreSetFailed).toBeCalledTimes(0);
    expect(coreError).toBeCalledTimes(0);
});

test('testing get-cmake action success with specific cmake versions', async () => {
    for (var version of ["latest", "latestrc", "~3.24", "3.x", "3.20.x", "^3.22", "3.19.8",
        "3.25.0-rc4", "3.25.0-rc3"]) {
        process.env.RUNNER_TEMP = os.tmpdir();
        process.env["CUSTOM_CMAKE_VERSION"] = version;
        await getcmake.main();
        expect(coreSetFailed).toBeCalledTimes(0);
        expect(coreError).toBeCalledTimes(0);
    }

    // A Linux ARM build is not available before 3.19.x
    if (process.platform === "linux" && process.arch === "x64" ) {
        for (var version of ["3.18.3", "3.16.1", "3.5.2", "3.3.0", "3.1.2"]) {
            process.env.RUNNER_TEMP = os.tmpdir();
            process.env["CUSTOM_CMAKE_VERSION"] = version;
            await getcmake.main();
            expect(coreSetFailed).toBeCalledTimes(0);
            expect(coreError).toBeCalledTimes(0);
        }
    }
});
