
// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as core from '@actions/core'
import * as getter from './get-cmake'
import * as cp from 'child_process'

async function main(): Promise<void> {
  try {
    const pathToCache = core.getState(getter.CMakeGetter.INPUT_PATH);
    process.env.INPUT_PATH = pathToCache;
    const options: cp.ExecSyncOptions = {
      env: process.env,
      stdio: "inherit",
    };
    console.log(cp.execSync(`node "./dist/save/index.js"`, options)?.toString());

    core.info('get-cmake action execution succeeded');
    process.exitCode = 0;
  } catch (err) {
    const errorAsString = (err ?? "undefined error").toString();
    core.debug('Error: ' + errorAsString);
    core.error(errorAsString);
    core.setFailed('get-cmake action execution failed');
    process.exitCode = -1000;
  }
}

// Main entry point of the task.
main().catch(error => console.error("main() failed!", error));