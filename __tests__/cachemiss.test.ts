// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as process from 'process';
import * as os from 'os';
import { CMakeGetter } from '../src/get-cmake';
import * as cache from '@actions/cache';
import * as core from '@actions/core';

jest.setTimeout(15 * 1000)
jest.mock('@actions/tool-cache');

var coreSetFailed = jest.spyOn(core, 'setFailed');

const cacheSaveCache = jest.spyOn(cache, 'saveCache').mockImplementation(() =>
    Promise.resolve(0)
);

const cacheRestoreCache = jest.spyOn(cache, 'restoreCache').mockImplementation(() =>
    Promise.resolve(undefined)
);

test('testing get-cache with cache-miss...', async () => {
    process.env.RUNNER_TEMP = os.tmpdir();
    const getter: CMakeGetter = new CMakeGetter();
    await getter.run();
    expect(cacheSaveCache).toBeCalledTimes(1);
    expect(cacheRestoreCache).toBeCalledTimes(1);
});
