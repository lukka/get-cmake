// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as process from 'process';
import * as os from 'os';
import * as path from 'path';
import { CMakeGetter } from '../src/get-cmake';
import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as tools from '@actions/tool-cache'


jest.setTimeout(15 * 1000)

jest.mock('@actions/tool-cache');

const cacheSaveCache = jest.spyOn(cache, 'saveCache').mockImplementation(() =>
    Promise.resolve(0)
);

const cacheRestoreCache = jest.spyOn(cache, 'restoreCache').mockImplementation(() =>
    Promise.resolve("key")
);

test('testing get-cache with cache-hit...', async () => {
    process.env.RUNNER_TEMP = os.tmpdir();
    const getter: CMakeGetter = new CMakeGetter();
    await getter.run();
    expect(cacheSaveCache).toBeCalledTimes(0);
    expect(cacheRestoreCache).toBeCalledTimes(1);
});
