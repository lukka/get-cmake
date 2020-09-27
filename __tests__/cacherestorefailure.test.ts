// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as process from 'process';
import * as os from 'os';
import * as path from 'path';
import { CMakeGetter } from '../src/get-cmake';
import * as cache from '@actions/cache';

jest.setTimeout(15 * 1000)

jest.mock('@actions/tool-cache');

jest.spyOn(cache, 'saveCache').mockImplementation(() =>
    Promise.resolve(0)
);

jest.spyOn(cache, 'restoreCache').mockImplementation(() => {
    throw new Error();
}
);

test('testing get-cache with restoreCache failure', async () => {
    process.env.RUNNER_TEMP = os.tmpdir();
    const getter: CMakeGetter = new CMakeGetter();
    await expect(getter.run()).rejects.toThrowError();
});
