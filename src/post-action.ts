
// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as core from '@actions/core'
import * as getter from './get-cmake'
import * as cp from 'child_process'
import * as path from 'path'

async function main(): Promise<void> {
  try {
    const pathToCache = core.getState(getter.CMakeGetter.INPUT_PATH);
    process.env.INPUT_PATH = pathToCache;
    const options: cp.ExecSyncOptions = {
      env: process.env,
      stdio: "inherit",
    };
    const scriptPath = path.join(path.dirname(path.dirname(__dirname)), 'actions/cache/dist/save/index.js');
    console.log(cp.execSync(`node ${scriptPath}`, options)?.toString());

    core.info('get-cmake post action execution succeeded');
    process.exitCode = 0;
  } catch (err) {
    const errorAsString = (err ?? "undefined error").toString();
    core.debug('Error: ' + errorAsString);
    core.error(errorAsString);
    core.setFailed('get-cmake post action execution failed');
    process.exitCode = -1000;
  }
}

// Main entry point of the task.
main().catch(error => console.error("main() failed!", error));