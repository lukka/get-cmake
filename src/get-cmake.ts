// Copyright (c) 2020 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as tools from '@actions/tool-cache';
import * as path from 'path';

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

export class ToolsGetter {
  private static readonly CMakeVersion = '3.18.3';
  private static readonly NinjaVersion = '1.10.1';

  // Predefined URL for CMake 
  private static readonly linux_x64: string = `https://github.com/Kitware/CMake/releases/download/v${ToolsGetter.CMakeVersion}/cmake-${ToolsGetter.CMakeVersion}-Linux-x86_64.tar.gz`;
  private static readonly win_x64: string = `https://github.com/Kitware/CMake/releases/download/v${ToolsGetter.CMakeVersion}/cmake-${ToolsGetter.CMakeVersion}-win64-x64.zip`;
  private static readonly macos: string = `https://github.com/Kitware/CMake/releases/download/v${ToolsGetter.CMakeVersion}/cmake-${ToolsGetter.CMakeVersion}-Darwin-x86_64.tar.gz`;

  // Predefined URL for ninja
  private static readonly ninja_linux_x64: string = `https://github.com/ninja-build/ninja/releases/download/v1.10.1/ninja-linux.zip`;
  private static readonly ninja_macos_x64: string = `https://github.com/ninja-build/ninja/releases/download/v1.10.1/ninja-mac.zip`;
  private static readonly ninja_windows_x64: string = `https://github.com/ninja-build/ninja/releases/download/v1.10.1/ninja-win.zip`;

  private static readonly cmakePackagesMap: { [key: string]: PackageInfo } = {
    "linux": {
      url: ToolsGetter.linux_x64,
      binPath: 'bin/',
      extractFunction: tools.extractTar, dropSuffix: ".tar.gz"
    },
    "win32": {
      url: ToolsGetter.win_x64,
      binPath: 'bin/',
      extractFunction: tools.extractZip, dropSuffix: ".zip"
    },
    "darwin": {
      url: ToolsGetter.macos,
      binPath: "CMake.app/Contents/bin/",
      extractFunction: tools.extractTar, dropSuffix: '.tar.gz'
    }
  };

  private static readonly ninjaPackagesMap: { [key: string]: PackageInfo } = {
    "linux": {
      url: ToolsGetter.ninja_linux_x64,
      binPath: '',
      extractFunction: tools.extractZip, dropSuffix: ".zip"
    },
    "win32": {
      url: ToolsGetter.ninja_windows_x64,
      binPath: '',
      extractFunction: tools.extractZip, dropSuffix: ".zip"
    },
    "darwin": {
      url: ToolsGetter.ninja_macos_x64,
      binPath: '',
      extractFunction: tools.extractZip, dropSuffix: '.zip'
    }
  };

  public async run(): Promise<void> {
    const cmakeData = ToolsGetter.cmakePackagesMap[process.platform];
    const ninjaData = ToolsGetter.ninjaPackagesMap[process.platform];
    await this.get(cmakeData, ninjaData);
  }

  private async get(cmakeData: PackageInfo, ninjaData: PackageInfo): Promise<void> {
    // Get an unique output directory name from the URL.
    const key: string = hashCode(`${cmakeData.url}${ninjaData.url}`);
    const outPath = this.getOutputPath(key);
    let hitKey: string | undefined;
    try {
      core.startGroup(`Restore from cache`);
      hitKey = await cache.restoreCache([outPath], key);
    } finally {
      core.endGroup();
    }

    if (hitKey === undefined) {
      await core.group("Download and extract CMake", async () => {
        const downloaded = await tools.downloadTool(cmakeData.url);
        await cmakeData.extractFunction(downloaded, outPath);
      });

      await core.group("Download and extract ninja", async () => {
        const downloaded = await tools.downloadTool(ninjaData.url);
        await ninjaData.extractFunction(downloaded, outPath);
      });
    }

    try {
      core.startGroup(`Add CMake and ninja to PATH`);
      const addr = new URL(cmakeData.url);
      const dirName = path.basename(addr.pathname);
      core.addPath(path.join(outPath, dirName.replace(cmakeData.dropSuffix, ''), cmakeData.binPath));
      core.addPath(outPath);
    } finally {
      core.endGroup();
    }

    try {
      core.startGroup('Save to cache');
      if (hitKey === undefined) {
        await cache.saveCache([outPath], key);
      } else {
        core.info("Skipping as cache hit.");
      }
    } finally {
      core.endGroup();
    }
  }

  private getOutputPath(subDir: string): string {
    if (!process.env.RUNNER_TEMP)
      throw new Error("Environment variable process.env.RUNNER_TEMP must be set, it is used as destination directory of the cache");
    return path.join(process.env.RUNNER_TEMP, subDir);;
  }
}

export async function main(): Promise<void> {
  try {
    const cmakeGetter: ToolsGetter = new ToolsGetter();
    await cmakeGetter.run();
    core.info('get-cmake action execution succeeded');
    process.exitCode = 0;
  } catch (err) {
    const error: Error = err as Error;
    if (error?.stack) {
      core.info(error.stack);
    }
    const errorAsString = (err ?? "undefined error").toString();
    core.setFailed(`get-cmake action execution failed: '${errorAsString}'`);
    process.exitCode = -1000;

  }
}
