// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as tools from '@actions/tool-cache'
import * as core from '@actions/core'
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs'

interface PackageInfo {
  url: string;
  binPath: string;
  extractFn: { (url: string, s: string): Promise<string> };
  dropSuffix: string;
}

/**
 * Compute an unique number given some text.
 * @param {string} text
 * @returns {string}
 */
function hashCode(text: string): string {
  let hash = 42;
  if (text.length != 0) {
    for (let i = 0; i < text.length; i++) {
      const char: number = text.charCodeAt(i);
      hash = ((hash << 5) + hash) ^ char;
    }
  }

  return hash.toString();
}

export class CMakeGetter {
  private static readonly linux_x64: string = "https://github.com/Kitware/CMake/releases/download/v3.17.0/cmake-3.17.0-Linux-x86_64.tar.gz";
  private static readonly win_x64: string = 'https://github.com/Kitware/CMake/releases/download/v3.17.0/cmake-3.17.0-win64-x64.zip';
  private static readonly macos: string = "https://github.com/Kitware/CMake/releases/download/v3.17.0/cmake-3.17.0-Darwin-x86_64.tar.gz";
  private static readonly Version = '3.17.0';
  private static readonly packagesMap: { [key: string]: PackageInfo } = {
    "linux": { url: CMakeGetter.linux_x64, binPath: 'bin/', extractFn: tools.extractTar, dropSuffix: ".tar.gz" },
    "win32": { url: CMakeGetter.win_x64, binPath: 'bin/', extractFn: tools.extractZip, dropSuffix: ".zip" },
    "darwin": { url: CMakeGetter.macos, binPath: "CMake.app/Contents/bin/", extractFn: tools.extractTar, dropSuffix: '.tar.gz' }
  };

  public static INPUT_PATH = "INPUT_PATH";

  public async run(): Promise<void> {
    const data = CMakeGetter.packagesMap[process.platform];
    //const outPath = path.join(process.env.RUNNER_TEMP!, hashCode(data.url));
    const cmakePath = await this.get(data);
    await tools.cacheDir(cmakePath, 'cmake', CMakeGetter.Version);
  }

  private async get(data: PackageInfo): Promise<string> {
    const key: string = hashCode(data.url);
    const outPath = this.getOutputPath(key);

    process.env.INPUT_KEY = key;
    process.env.INPUT_PATH = outPath;
    core.saveState(CMakeGetter.INPUT_PATH, outPath);
    const options: cp.ExecSyncOptions = {
      env: process.env,
      stdio: "inherit",
    };
    console.log(`Running restore-cache: ${cp.execSync(`node "./dist/restore/index.js"`, options)?.toString()}`);

    if (!fs.existsSync(outPath)) {
      const downloaded = await tools.downloadTool(data.url);
      await data.extractFn(downloaded, outPath);
    }

    // Add to PATH env var the cmake executable.
    const addr = new URL(data.url);
    const dirName = path.basename(addr.pathname);
    core.addPath(path.join(outPath, dirName.replace(data.dropSuffix, ''), data.binPath));
    return outPath;
  }

  private getOutputPath(subDir: string): string {
    if (!process.env.RUNNER_TEMP)
      throw new Error("Env var process.env.RUNNER_TEMP must be set, it is used as destination directory of the cache tools");
    return path.join(process.env.RUNNER_TEMP, subDir);;
  }
}