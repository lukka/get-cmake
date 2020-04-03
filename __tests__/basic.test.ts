// Copyright (c) 2019-2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import * as io from '@actions/io'

const tempDirectory = path.join(__dirname, "tempDirectory");
const testScript = path.join(__dirname, '..', 'dist', 'index.js');;

jest.setTimeout(15 * 1000)

describe('get-cmake tests', () => {
    beforeEach(async () => {
        await io.rmRF(tempDirectory);
        await io.mkdirP(tempDirectory);
        Object.keys(process.env)
            .filter((key) => key.match(/^INPUT_/))
            .forEach((key) => {
                delete process.env[key];
            });
        process.env.GITHUB_WORKSPACE = tempDirectory;
        process.env.RUNNER_TEMP = path.join (tempDirectory, "temp");
        process.env.RUNNER_TOOL_CACHE = path.join (tempDirectory, "tempToolCache");
    });

    afterAll(async () => {
        try {
            await io.rmRF(tempDirectory);
        } catch {
            console.log('Failed to remove test directories');
        }
    }, 100000);

    test('basic test for get-cmake', () => {
        const options: cp.ExecSyncOptions = {
            env: process.env,
            stdio: "inherit"
        };
        console.log(cp.execSync(`node ${testScript}`, options)?.toString());
    });

});