// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as os from 'os';
import * as getcmake from '../src/get-cmake';
import * as cache from '@actions/cache';
import * as toolcache from '@actions/tool-cache';
import * as core from '@actions/core';

jest.setTimeout(15 * 1000)

jest.mock('@actions/tool-cache');

jest.spyOn(cache, 'saveCache').mockImplementation(() =>
    Promise.resolve(0)
);

jest.spyOn(cache, 'restoreCache').mockImplementation(() =>
    Promise.resolve("42")
);

var coreSetFailed = jest.spyOn(core, 'setFailed');
var coreError = jest.spyOn(core, 'error');
var toolsCacheDir = jest.spyOn(toolcache, 'cacheDir');

test('testing get-cmake action success', async () => {
    process.env.RUNNER_TEMP = os.tmpdir();
    await getcmake.main();
    expect(coreSetFailed).toBeCalledTimes(0);
    expect(coreError).toBeCalledTimes(0);
});
