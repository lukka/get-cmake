// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as process from 'process';
import * as os from 'os';
import * as path from 'path';
import { ToolsGetter } from '../src/get-cmake';
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

test('testing get-cmake with restoreCache failure', async () => {
    process.env.RUNNER_TEMP = os.tmpdir();
    const getter: ToolsGetter = new ToolsGetter();
    await expect(getter.run()).rejects.toThrowError();
});
