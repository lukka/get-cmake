// Copyright (c) 2020-2021-2022 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as io from '@actions/io';
import * as tools from '@actions/tool-cache';
import * as path from 'path';
import * as catalog from './releases-catalog'
import { PackageInfo, CatalogType } from './shared';

const extractFunction: { [key: string]: { (url: string, outputPath: string): Promise<string> } } = {
  '.tar.gz': tools.extractTar,
  '.zip': tools.extractZip
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
  private cmakeVersion: string;
  private ninjaVersion: string;

  constructor(private cmakeOverride?: string, private ninjaOverride?: string) {
    core.info(`user defined cmake version:${this.cmakeOverride}`);
    core.info(`user defined ninja version:${this.ninjaOverride}`);

    this.cmakeVersion = cmakeOverride || ToolsGetter.CMakeDefaultVersion;
    this.ninjaVersion = ninjaOverride || ToolsGetter.NinjaDefaultVersion;

    core.info(`cmake version:${this.cmakeVersion}`);
    core.info(`ninja version:${this.ninjaVersion}`);
  }

  public async run(): Promise<void> {
    // Predefined URL for ninja
    const NinjaLinuxX64 = `https://github.com/ninja-build/ninja/releases/download/v${this.ninjaVersion}/ninja-linux.zip`;
    const NinjaMacosX64 = `https://github.com/ninja-build/ninja/releases/download/v${this.ninjaVersion}/ninja-mac.zip`;
    const NinjaWindowsX64 = `https://github.com/ninja-build/ninja/releases/download/v${this.ninjaVersion}/ninja-win.zip`;

    const cmakePackages = (catalog.cmakeCatalog as CatalogType)[this.cmakeVersion]
    if (!cmakePackages)
      throw Error(`Cannot find in the catalog the CMake version: ${this.cmakeVersion}`);
    const cmakePackage = cmakePackages[process.platform];

    const ninjaPackagesMap: { [key: string]: PackageInfo } = {
      "linux": {
        url: NinjaLinuxX64,
        binPath: '',
        dropSuffix: ".zip",
      },
      "win32": {
        url: NinjaWindowsX64,
        binPath: '',
        dropSuffix: ".zip",
      },
      "darwin": {
        url: NinjaMacosX64,
        binPath: '',
        dropSuffix: '.zip',
      }
    };

    await this.get(cmakePackage, ninjaPackagesMap[process.platform]);
  }

  private async get(cmakePackage: PackageInfo, ninjaPackage: PackageInfo): Promise<void> {
    // Get an unique output directory name from the URL.
    const inputHash = `${cmakePackage.url}${ninjaPackage.url}`;
    const key: string = hashCode(inputHash);
    core.debug(`hash('${inputHash}') === '${key}'`);
    const outPath = this.getOutputPath(key);
    let hitKey: string | undefined = undefined;
    try {
      core.startGroup(`Restore from cache using key '${key}' into '${outPath}'`);
      hitKey = await cache.restoreCache([outPath], key);
      core.info(hitKey === undefined ? "Cache miss." : "Cache hit.");
    } finally {
      core.endGroup();
    }

    if (hitKey === undefined) {
      await core.group("Download and extract CMake", async () => {
        const downloaded = await tools.downloadTool(cmakePackage.url);
        await extractFunction[cmakePackage.dropSuffix](downloaded, outPath);
      });

      await core.group("Download and extract ninja", async () => {
        const downloaded = await tools.downloadTool(ninjaPackage.url);
        await extractFunction[ninjaPackage.dropSuffix](downloaded, outPath);
      });
    }

    try {
      if (!cmakePackage.fileName) {
        throw new Error("The file name of the CMake archive is required but it is missing!");
      }

      core.startGroup(`Add CMake and ninja to PATH`);
      const cmakePath = path.join(outPath, cmakePackage.fileName.replace(cmakePackage.dropSuffix, ''), cmakePackage.binPath)

      core.info(`CMake path: ${cmakePath}`);
      core.addPath(cmakePath);
      core.info(`Ninja path: ${outPath}`);
      core.addPath(outPath);

      try {
        core.startGroup(`Validation of installed CMake and ninja`);
        const cmakeWhichPath: string = await io.which('cmake', true);
        const ninjaWhichPath: string = await io.which('ninja', true);
        core.info(`CMake actual path is: ${cmakeWhichPath}`);
        core.info(`ninja actual path is: ${ninjaWhichPath}`);
      } finally {
        core.endGroup();
      }
    } finally {
      core.endGroup();
    }


    try {
      core.startGroup(`Save to cache using key '${key}': '${outPath}'`);
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