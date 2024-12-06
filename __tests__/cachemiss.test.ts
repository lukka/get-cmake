// Copyright (c) 2020, 2021, 2022 Luca Cappa

// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as process from 'process';
import * as os from 'os';
import { ToolsGetter } from '../src/get-cmake';
import * as cache from '@actions/cache';
import * as core from '@actions/core';
import path = require('path');
import * as crypto from 'crypto';

// 10 minutes
jest.setTimeout(10 * 60 * 1000)

var coreSetFailed = jest.spyOn(core, 'setFailed');

const cacheSaveCache = jest.spyOn(cache, 'saveCache').mockImplementation(() =>
    Promise.resolve(0)
);

const cacheRestoreCache = jest.spyOn(cache, 'restoreCache').mockImplementation(() =>
    Promise.resolve(undefined)
);

// Avoiding messing with PATH during test execution.
const addToolsToPath = jest.spyOn(ToolsGetter.prototype as any, 'addToolsToPath').mockResolvedValue(0);

test('testing get-cmake with cache-miss...', async () => {
    const testId = crypto.randomBytes(16).toString('hex');
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), `${testId}`);
    const getter: ToolsGetter = new ToolsGetter();
    await getter.run();
    expect(cacheSaveCache).toBeCalledTimes(1);
    expect(cacheRestoreCache).toBeCalledTimes(1);
    expect(coreSetFailed).toBeCalledTimes(0);
});
