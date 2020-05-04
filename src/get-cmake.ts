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
  extractFunction: { (url: string, outputPath: string): Promise<string> };
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
  private static readonly Version = '3.17.2';

  // Predefined URL for CMake 
  private static readonly linux_x64: string = `https://github.com/Kitware/CMake/releases/download/v${CMakeGetter.Version}/cmake-${CMakeGetter.Version}-Linux-x86_64.tar.gz`;
  private static readonly win_x64: string = `https://github.com/Kitware/CMake/releases/download/v${CMakeGetter.Version}/cmake-${CMakeGetter.Version}-win64-x64.zip`;
  private static readonly macos: string = `https://github.com/Kitware/CMake/releases/download/v${CMakeGetter.Version}/cmake-${CMakeGetter.Version}-Darwin-x86_64.tar.gz`;

  private static readonly packagesMap: { [key: string]: PackageInfo } = {
    "linux": {
      url: CMakeGetter.linux_x64, binPath: 'bin/',
      extractFunction: tools.extractTar, dropSuffix: ".tar.gz"
    },
    "win32": {
      url: CMakeGetter.win_x64, binPath: 'bin/',
      extractFunction: tools.extractZip, dropSuffix: ".zip"
    },
    "darwin": {
      url: CMakeGetter.macos, binPath: "CMake.app/Contents/bin/",
      extractFunction: tools.extractTar, dropSuffix: '.tar.gz'
    }
  };

  public static INPUT_PATH = "INPUT_PATH";

  public async run(): Promise<void> {
    const data = CMakeGetter.packagesMap[process.platform];
    const cmakePath = await this.get(data);
    await tools.cacheDir(cmakePath, 'cmake', CMakeGetter.Version);
  }

  private async get(data: PackageInfo): Promise<string> {
    // Get an unique output directory name from the URL.
    const key: string = hashCode(data.url);
    const outPath = this.getOutputPath(key);
    try {
      core.startGroup(`Restore from cache`);
      // Use the embedded actions/cache to cache the downloaded CMake binaries.
      process.env.INPUT_KEY = key;
      process.env.INPUT_PATH = outPath;
      core.saveState(CMakeGetter.INPUT_PATH, outPath);
      const options: cp.ExecSyncOptions = {
        env: process.env,
        stdio: "inherit",
      };
      const scriptPath = path.join(__dirname, '../actions/cache/dist/restore/index.js');
      cp.execSync(`node ${scriptPath}`, options);
    } finally {
      core.endGroup();
    }

    if (!fs.existsSync(outPath)) {
      await core.group("Download and extract CMake", async () => {
        const downloaded = await tools.downloadTool(data.url);
        await data.extractFunction(downloaded, outPath);
      });
    }

    try {
      core.startGroup(`Add CMake to PATH`);
      // Add to PATH env var the CMake executable.
      const addr = new URL(data.url);
      const dirName = path.basename(addr.pathname);
      core.addPath(path.join(outPath, dirName.replace(data.dropSuffix, ''), data.binPath));
    } finally {
      core.endGroup();
    }

    return outPath;
  }

  private getOutputPath(subDir: string): string {
    if (!process.env.RUNNER_TEMP)
      throw new Error("Environment variable process.env.RUNNER_TEMP must be set, it is used as destination directory of the cache");
    return path.join(process.env.RUNNER_TEMP, subDir);;
  }
}