// Copyright (c) 2020-2021-2022 Luca Cappa
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
  let hash = 41;
  if (text.length != 0) {
    for (let i = 0; i < text.length; i++) {
      const char: number = text.charCodeAt(i);
      hash = ((hash << 5) + hash) ^ char;
    }
  }

  return hash.toString();
}

export class ToolsGetter {
  private static readonly CMakeDefaultVersion = '3.24.3';
  private static readonly NinjaDefaultVersion = '1.11.1';
  private cmakeVersion: string | undefined;
  private ninjaVersion: string | undefined;

  constructor(private cmakeOverride?: string, private ninjaOverride?: string) {
    this.cmakeVersion = cmakeOverride || ToolsGetter.CMakeDefaultVersion;
    core.debug(`user defined cmake version:${this.cmakeVersion}`);
    this.ninjaVersion = ninjaOverride || ToolsGetter.NinjaDefaultVersion;
    core.debug(`user defined ninja version:${this.ninjaVersion}`);
  }

  public async run(): Promise<void> {

    // Predefined URL for CMake 
    const LinuxX64 = `https://github.com/Kitware/CMake/releases/download/v${this.cmakeVersion}/cmake-${this.cmakeVersion}-linux-x86_64.tar.gz`;
    const WinX64 = `https://github.com/Kitware/CMake/releases/download/v${this.cmakeVersion}/cmake-${this.cmakeVersion}-windows-x86_64.zip`;
    const MacOs = `https://github.com/Kitware/CMake/releases/download/v${this.cmakeVersion}/cmake-${this.cmakeVersion}-macos-universal.tar.gz`;

    // Predefined URL for ninja
    const NinjaLinuxX64 = `https://github.com/ninja-build/ninja/releases/download/v${this.ninjaVersion}/ninja-linux.zip`;
    const NinjaMacosX64 = `https://github.com/ninja-build/ninja/releases/download/v${this.ninjaVersion}/ninja-mac.zip`;
    const NinjaWindowsX64 = `https://github.com/ninja-build/ninja/releases/download/v${this.ninjaVersion}/ninja-win.zip`;

    const cmakePackagesMap: { [key: string]: PackageInfo } = {
      "linux": {
        url: LinuxX64,
        binPath: 'bin/',
        extractFunction: tools.extractTar, dropSuffix: ".tar.gz"
      },
      "win32": {
        url: WinX64,
        binPath: 'bin/',
        extractFunction: tools.extractZip, dropSuffix: ".zip"
      },
      "darwin": {
        url: MacOs,
        binPath: "CMake.app/Contents/bin/",
        extractFunction: tools.extractTar, dropSuffix: '.tar.gz'
      }
    };

    const ninjaPackagesMap: { [key: string]: PackageInfo } = {
      "linux": {
        url: NinjaLinuxX64,
        binPath: '',
        extractFunction: tools.extractZip, dropSuffix: ".zip"
      },
      "win32": {
        url: NinjaWindowsX64,
        binPath: '',
        extractFunction: tools.extractZip, dropSuffix: ".zip"
      },
      "darwin": {
        url: NinjaMacosX64,
        binPath: '',
        extractFunction: tools.extractZip, dropSuffix: '.zip'
      }
    };

    await this.get(cmakePackagesMap[process.platform], ninjaPackagesMap[process.platform]);
  }

  private async get(cmakeData: PackageInfo, ninjaData: PackageInfo): Promise<void> {
    // Get an unique output directory name from the URL.
    const inputHash = `${cmakeData.url}${ninjaData.url}`;
    const key: string = hashCode(inputHash);
    core.debug(`hash('${inputHash}') === '${key}'`);
    const outPath = this.getOutputPath(key);
    let hitKey: string | undefined = undefined;
    try {
      core.startGroup(`Restore from cache using key '${key}' into ${outPath}`);
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
      const cmakePath = path.join(outPath, dirName.replace(cmakeData.dropSuffix, ''), cmakeData.binPath)
      core.debug(`CMake path: ${cmakePath}`);
      core.addPath(cmakePath);
      core.debug(`Ninja path: ${outPath}`);
      core.addPath(outPath);
    } finally {
      core.endGroup();
    }

    try {
      core.startGroup(`Save to cache using key '${key}' into ${outPath}`);
      if (hitKey === undefined) {
        await this.saveCache([outPath], key);
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

  private async saveCache(paths: string[], key: string): Promise<number | undefined> {
    try {
      return await cache.saveCache(paths, key);
    }
    catch (error: any) {
      if (error.name === cache.ValidationError.name) {
        throw error;
      } else if (error.name === cache.ReserveCacheError.name) {
        core.info(error.message);
      } else {
        core.warning(error.message);
      }
    }
  }
}


export async function main(): Promise<void> {
  try {
    const cmakeGetter: ToolsGetter = new ToolsGetter(core.getInput('cmakeVersion'), core.getInput('ninjaVersion'));
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