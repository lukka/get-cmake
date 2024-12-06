// Copyright (c) 2022 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as os from 'os';
import * as crypto from 'crypto';
import * as toolcache from '@actions/tool-cache';
import * as core from '@actions/core';
import * as path from 'path'
import { main, ToolsGetter } from '../src/get-cmake';

// 30 minutes
jest.setTimeout(30 * 60 * 1000)

const localCacheInput = "__TEST__USE_LOCAL_CACHE";
const cloudCacheInput = "__TEST__USE_CLOUD_CACHE";
const localCacheHit = "__TEST__LOCAL_CACHE_HIT";
const cloudCacheHit = "__TEST__CLOUD_CACHE_HIT";

let restoreCache = jest.spyOn(ToolsGetter.prototype as any, 'restoreCache');
let saveCache = jest.spyOn(ToolsGetter.prototype as any, 'saveCache');

jest.spyOn(core, 'getInput').mockImplementation((arg: string, options: core.InputOptions | undefined): string => {
    if (arg === "cmakeVersion")
        return process.env["CUSTOM_CMAKE_VERSION"] || "";
    else
        return "";
});

jest.spyOn(core, 'getBooleanInput').mockImplementation((arg: string, options: core.InputOptions | undefined): boolean => {
    switch (arg) {
        case "useLocalCache":
            return process.env[localCacheInput] === "true";
        case "useCloudCache":
            return process.env[cloudCacheInput] === "true";
        default:
            return false;
    }
});

// Avoiding messing with PATH during test execution.
const addToolsToPath = jest.spyOn(ToolsGetter.prototype as any, 'addToolsToPath').mockResolvedValue(0);

var coreSetFailed = jest.spyOn(core, 'setFailed');
var coreError = jest.spyOn(core, 'error');
var toolsCacheDir = jest.spyOn(toolcache, 'cacheDir');
var toolsFind = jest.spyOn(toolcache, 'find');

test('testing get-cmake action success with cloud/local cache enabled', async () => {
    const testId = crypto.randomBytes(16).toString('hex');
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), `${testId}`);
    process.env.RUNNER_TOOL_CACHE = path.join(os.tmpdir(), `${testId}-cache`);

    for (var matrix of [
        { version: "latest", cloudCache: "true", localCache: "true" },
        { version: "latest", cloudCache: "true", localCache: "false" },
        { version: "latest", cloudCache: "false", localCache: "true" },
        { version: "latest", cloudCache: "false", localCache: "false" }]) {

        console.log(`\n\ntesting for: ${JSON.stringify(matrix)}:\n`)

        process.env["CUSTOM_CMAKE_VERSION"] = matrix.version;
        process.env[localCacheInput] = matrix.localCache;
        process.env[cloudCacheInput] = matrix.cloudCache;
        await main();
        expect(coreSetFailed).toBeCalledTimes(0);
        expect(coreError).toBeCalledTimes(0);
        expect(toolsCacheDir).toBeCalledTimes(matrix.localCache === "true" ? 1 : 0);
        const toolsFindInvocationCount = matrix.localCache === "true" ? 1 : 0;
        expect(toolsFind).toBeCalledTimes(toolsFindInvocationCount);
        expect(saveCache).toBeCalledTimes(matrix.cloudCache === "true" ? 1 : 0);
        expect(restoreCache).toBeCalledTimes(matrix.cloudCache === "true" ? 1 : 0);

        saveCache.mockReset();
        restoreCache.mockReset();
        toolsCacheDir.mockReset();
        toolsFind.mockReset();
    }
});

test('testing get-cmake action success with local or cloud cache hits', async () => {
    const testId = crypto.randomBytes(16).toString('hex');
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), `${testId}`);
    process.env.RUNNER_TOOL_CACHE = path.join(os.tmpdir(), `${testId}-cache`);

    for (var matrix of [
        { version: "latest", cloudCache: true, localCache: true, localHit: false, cloudHit: true },
        { version: "latest", cloudCache: false, localCache: true, localHit: false, cloudHit: false },
        { version: "latest", cloudCache: true, localCache: true, localHit: true, cloudHit: false },
        { version: "latest", cloudCache: false, localCache: true, localHit: true, cloudHit: false },
    ]) {
        saveCache.mockReset().mockResolvedValue(0);
        restoreCache.mockReset().mockImplementation(
            async () => {
                return Promise.resolve(process.env[cloudCacheHit] === 'true' ? "hit" : "");
            });
        toolsCacheDir.mockReset().mockResolvedValue("mock");
        toolsFind.mockReset().mockImplementation((toolName: string, versionSpec: string, arch?: string | undefined): string => {
            return process.env[localCacheHit] === 'true' ? "hit" : "";
        });

        console.log(`\n\ntesting for: ${JSON.stringify(matrix)}:\n`)
        process.env["CUSTOM_CMAKE_VERSION"] = matrix.version;
        process.env[localCacheInput] = String(matrix.localCache);
        process.env[cloudCacheInput] = String(matrix.cloudCache);
        process.env[localCacheHit] = String(matrix.localHit);
        process.env[cloudCacheHit] = String(matrix.cloudHit);
        await main();
        expect(coreSetFailed).toBeCalledTimes(0);
        expect(coreError).toBeCalledTimes(0);
        const toolsFindInvocationCount = matrix.localCache ? 1 : 0;
        expect(toolsFind).toBeCalledTimes(toolsFindInvocationCount);
        const toolsCacheDirInvocationCount: number = !matrix.localCache || matrix.localHit ? 0 : 1;
        expect(toolsCacheDir).toBeCalledTimes(toolsCacheDirInvocationCount);
        expect(toolsFind).toHaveNthReturnedWith(1, matrix.localHit ? "hit" : "");
        expect(saveCache).toBeCalledTimes((matrix.cloudHit || !matrix.cloudCache || matrix.localHit) ? 0 : 1);
        expect(restoreCache).toBeCalledTimes((matrix.localHit || !matrix.cloudCache) ? 0 : 1);
    }
});

test('testing get-cmake action store and restore local cache', async () => {
    toolsCacheDir.mockRestore();
    toolsFind.mockRestore();

    const testId = crypto.randomBytes(16).toString('hex');
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), `${testId}`);
    process.env.RUNNER_TOOL_CACHE = path.join(os.tmpdir(), `${testId}-cache`);
    let downloadMock = undefined;

    for (var matrix of [
        { version: "latest", cloudCache: false, localCache: true, localHit: false, cloudHit: false },
        { version: "latest", cloudCache: false, localCache: true, localHit: true, cloudHit: false },
    ]) {
        console.log(`\n\ntesting for: ${JSON.stringify(matrix)}:\n`)
        process.env["CUSTOM_CMAKE_VERSION"] = matrix.version;
        process.env[localCacheInput] = String(matrix.localCache);
        process.env[cloudCacheInput] = String(matrix.cloudCache);
        await main();
        expect(coreSetFailed).toBeCalledTimes(0);
        expect(coreError).toBeCalledTimes(0);
        expect(saveCache).toBeCalledTimes(0);
        expect(restoreCache).toBeCalledTimes(0);
        // After cache has been stored once (in the first iteration), it must be fetched from the cache and not downloaded anymore.
        if (downloadMock) {
            expect(downloadMock).toBeCalledTimes(0);
        }

        // Second iteration, check that the download function is not called because the local cache hits.
        downloadMock = jest.spyOn(ToolsGetter.prototype as any, 'downloadTools');
    }
});
