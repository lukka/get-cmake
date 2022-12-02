// Copyright (c) 2020-2021-2022 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as io from '@actions/io';
import * as tools from '@actions/tool-cache';
import * as path from 'path';
import { SemVer, compare, maxSatisfying } from 'semver';
import * as catalog from './releases-catalog'
import * as shared from './releases-collector'

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
  private static readonly CMakeDefaultVersion = 'latest';
  private static readonly NinjaDefaultVersion = 'latest';
  private requestedCMakeVersion: string;
  private requestedNinjaVersion: string;

  constructor(private cmakeOverride?: string, private ninjaOverride?: string) {
    core.info(`user defined cmake version:${this.cmakeOverride}`);
    core.info(`user defined ninja version:${this.ninjaOverride}`);

    this.requestedCMakeVersion = cmakeOverride || ToolsGetter.CMakeDefaultVersion;
    this.requestedNinjaVersion = ninjaOverride || ToolsGetter.NinjaDefaultVersion;

    core.info(`cmake version:${this.requestedCMakeVersion}`);
    core.info(`ninja version:${this.requestedNinjaVersion}`);
  }

  public async run(): Promise<void> {
    const cmakeVer = ToolsGetter.matchRange(catalog.cmakeCatalog, this.requestedCMakeVersion, "cmake");
    if (!cmakeVer)
      throw Error(`Cannot match CMake version:'${this.requestedCMakeVersion}' in the catalog.`);
    const cmakePackages = (catalog.cmakeCatalog as shared.CatalogType)[cmakeVer]
    if (!cmakePackages)
      throw Error(`Cannot find CMake version:'${this.requestedCMakeVersion}' in the catalog.`);
    const cmakePackage = cmakePackages[process.platform];
    if (!cmakePackage)
      throw Error(`Cannot find CMake version:'${this.requestedCMakeVersion}' in the catalog for the '${process.platform}' platform.`);

    const ninjaVer = ToolsGetter.matchRange(catalog.ninjaCatalog, this.requestedNinjaVersion, "ninja");
    if (!ninjaVer)
      throw Error(`Cannot match Ninja version:'${this.requestedNinjaVersion}' in the catalog.`);
    const ninjaPackages = (catalog.ninjaCatalog as shared.CatalogType)[ninjaVer]
    if (!ninjaPackages)
      throw Error(`Cannot find Ninja version:'${this.requestedNinjaVersion}' in the catalog.`);
    const ninjaPackage = ninjaPackages[process.platform];
    if (!ninjaPackage)
      throw Error(`Cannot find Ninja version:'${this.requestedNinjaVersion}' in the catalog for the '${process.platform}' platform.`);

    await this.get(cmakePackage, ninjaPackage);
  }

  private static matchRange(theCat: shared.CatalogType, range: string, toolName: string): string {
    try {
      const packages = theCat[range];
      if (!packages)
        throw Error(`Cannot find version:'${range}' in the catalog.`);
      const aPackage = packages[process.platform];
      if (!aPackage)
        throw Error(`Cannot find ${toolName} version '${range}' in the catalog for the '${process.platform}' platform.`);
      // 'range' is a well defined version.
      return range;
    } catch {
      // Try to use the range to find the version ...
      core.debug(`Collecting semvers list... `);
      const matches: SemVer[] = [];
      Object.keys(theCat).forEach(function (release) {
        try {
          matches.push(new SemVer(release));
        } catch {
          core.debug(`Skipping ${release}`);
        }
      });
      const match = maxSatisfying(matches, range);
      if (!match || !match.version) {
        throw new Error(`Cannot match '${range}' with any version in the catalog for '${toolName}'.`);
      }
      return match.version;
    }
  }

  private async get(cmakePackage: shared.PackageInfo, ninjaPackage: shared.PackageInfo): Promise<void> {
    let key: string, outPath: string;
    try {
      core.startGroup(`Compute cache key from the download's URLs`);
      // Get an unique output directory name from the URL.
      const inputHash = `${cmakePackage.url}${ninjaPackage.url}`;
      key = hashCode(inputHash);
      core.info(`Cache key: ${key}`);
      core.debug(`hash('${inputHash}') === '${key}'`);
      outPath = this.getOutputPath(key);
    } finally {
      core.endGroup();
    }

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

      await core.group("Download and extract Ninja", async () => {
        const downloaded = await tools.downloadTool(ninjaPackage.url);
        await extractFunction[ninjaPackage.dropSuffix](downloaded, outPath);
      });
    }

    try {
      if (!cmakePackage.fileName) {
        throw new Error("The file name of the CMake archive is required but it is missing!");
      }

      core.startGroup(`Add CMake and Ninja to PATH`);
      const cmakePath = path.join(outPath, cmakePackage.fileName.replace(cmakePackage.dropSuffix, ''), cmakePackage.binPath)

      core.info(`CMake path: ${cmakePath}`);
      core.addPath(cmakePath);
      core.info(`Ninja path: ${outPath}`);
      core.addPath(outPath);

      try {
        core.startGroup(`Validation of the installed CMake and Ninja`);
        const cmakeWhichPath: string = await io.which('cmake', true);
        const ninjaWhichPath: string = await io.which('ninja', true);
        core.info(`CMake actual path is: '${cmakeWhichPath}'`);
        core.info(`Ninja actual path is: '${ninjaWhichPath}'`);
      } finally {
        core.endGroup();
      }
    } finally {
      core.endGroup();
    }

    try {
      core.startGroup(`Save to cache using key '${key}'`);
      if (hitKey === undefined) {
        await this.saveCache([outPath], key);
        core.info(`Save '${outPath}' to the GitHub cache service.`);
      } else {
        core.info("Skipping saving cache since there was a cache hit for the computed key.");
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