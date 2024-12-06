// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as os from 'os';
import * as cache from '@actions/cache';
import * as toolcache from '@actions/tool-cache';
import * as core from '@actions/core';
import * as getcmake from '../src/get-cmake';
import path = require('path');
import { ToolsGetter } from '../src/get-cmake';
import * as crypto from 'crypto';

// 10 minutes
jest.setTimeout(10 * 60 * 1000)

jest.spyOn(cache, 'saveCache').mockImplementation(() =>
    Promise.resolve(0)
);

jest.spyOn(cache, 'restoreCache').mockImplementation(() => {
    throw new Error();
}
);

jest.spyOn(core, 'getBooleanInput').mockImplementation((arg: string, options: core.InputOptions | undefined): boolean => {
    return true;
});

// Avoiding messing with PATH during test execution.
const addToolsToPath = jest.spyOn(ToolsGetter.prototype as any, 'addToolsToPath').mockResolvedValue(0);

// Avoid any side effect of core.setFailed and core.error, they may fail the workflow, but this test is suppposed 
// to fail, but workflow step (i.e. in this case `npm run test`) should not fail.
var coreSetFailed = jest.spyOn(core, 'setFailed').mockImplementation(() => {});
var coreError = jest.spyOn(core, 'error').mockImplementation(() => {});
var toolsCacheDir = jest.spyOn(toolcache, 'cacheDir');

test('testing get-cmake action failure', async () => {
    const testId = crypto.randomBytes(16).toString('hex');
    process.exitCode
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), `${testId}`);
    process.env.RUNNER_TOOL_CACHE = path.join(os.tmpdir(), `${testId}-cache`);
    await getcmake.main();
    expect(coreSetFailed).toBeCalledTimes(1);
    expect(coreError).toBeCalledTimes(0);
    expect(toolsCacheDir).toBeCalledTimes(0);
    
    jest.clearAllMocks();
    // The failure sets an exit code different than 0, and this will fail `npm run test`.
    // On node20+ on Linux/Windows (but not on macOS) this leads to a failing exit 
    // code: https://github.com/jestjs/jest/issues/14501
    process.exitCode = 0;
});
