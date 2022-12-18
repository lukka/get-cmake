// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as os from 'os';
import * as cache from '@actions/cache';
import * as toolcache from '@actions/tool-cache';
import * as core from '@actions/core';
import * as getcmake from '../src/get-cmake';
import path = require('path');

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

var coreSetFailed = jest.spyOn(core, 'setFailed');
var coreError = jest.spyOn(core, 'error');
var toolsCacheDir = jest.spyOn(toolcache, 'cacheDir');

test('testing get-cmake action failure', async () => {
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), `${process.pid}`);
    process.env.RUNNER_TOOL_CACHE = path.join(os.tmpdir(), `${process.pid}-cache`);
    await getcmake.main();
    expect(coreSetFailed).toBeCalledTimes(1);
    expect(coreError).toBeCalledTimes(0);
    expect(toolsCacheDir).toBeCalledTimes(0);
});
