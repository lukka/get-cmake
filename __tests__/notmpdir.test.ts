// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import { ToolsGetter } from '../src/get-cmake';
import * as cache from '@actions/cache';

// 10 minutes
jest.setTimeout(10 * 60 * 1000)

jest.spyOn(cache, 'saveCache').mockImplementation(() =>
    Promise.resolve(0)
);

jest.spyOn(cache, 'restoreCache').mockImplementation(() => {
    throw new Error();
}
);

test('testing get-cmake with no temporary directory failure', async () => {
    delete process.env.RUNNER_TEMP;
    const getter: ToolsGetter = new ToolsGetter();
    await expect(getter.run()).rejects.toThrowError();
});
