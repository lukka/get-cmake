// Copyright (c) 2020-2021-2022 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as io from '@actions/io';
import * as tools from '@actions/tool-cache';
import * as path from 'path';
import { SemVer, maxSatisfying } from 'semver';
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
function hashCode(text: string): number {
  let hash = 41;
  if (text.length != 0) {
    for (let i = 0; i < text.length; i++) {
      const char: number = text.charCodeAt(i);
      hash = ((hash << 5) + hash) ^ char;
    }
  }

  return Math.abs(hash);
}

export class ToolsGetter {
  private static readonly CMakeDefaultVersion = 'latest';
  private static readonly NinjaDefaultVersion = 'latest';
  private static readonly LocalCacheName = "cmakeninja";
  private requestedCMakeVersion: string;
  private requestedNinjaVersion: string;

  public constructor(private cmakeOverride?: string, private ninjaOverride?: string,
    private useCloudCache: boolean = true, private useLocalCache: boolean = false) {
    core.info(`useCloudCache:${this.useCloudCache}`);
    core.info(`useLocalCache:${this.useLocalCache}`);

    core.info(`user defined cmake version:${this.cmakeOverride}`);
    core.info(`user defined ninja version:${this.ninjaOverride}`);

    this.requestedCMakeVersion = cmakeOverride || ToolsGetter.CMakeDefaultVersion;
    this.requestedNinjaVersion = ninjaOverride || ToolsGetter.NinjaDefaultVersion;

    core.info(`cmake version:${this.requestedCMakeVersion}`);
    core.info(`ninja version:${this.requestedNinjaVersion}`);
  }

  public async run(): Promise<void> {
    const targetArchPlat = shared.getArchitecturePlatform();
    const cmakeVer = ToolsGetter.matchRange(catalog.cmakeCatalog, this.requestedCMakeVersion, "cmake");
    if (!cmakeVer)
      throw Error(`Cannot match CMake version:'${this.requestedCMakeVersion}' in the catalog.`);
    const cmakePackages = (catalog.cmakeCatalog as shared.CatalogType)[cmakeVer];
    if (!cmakePackages)
      throw Error(`Cannot find CMake version:'${this.requestedCMakeVersion}' in the catalog.`);
    const cmakePackage = cmakePackages[targetArchPlat];
    core.debug(`cmakePackages: ${JSON.stringify(cmakePackages)}`);
    if (!cmakePackage)
      throw Error(`Cannot find CMake version:'${this.requestedCMakeVersion}' in the catalog for the '${targetArchPlat}' platform.`);

    const ninjaVer = ToolsGetter.matchRange(catalog.ninjaCatalog, this.requestedNinjaVersion, "ninja");
    if (!ninjaVer)
      throw Error(`Cannot match Ninja version:'${this.requestedNinjaVersion}' in the catalog.`);
    const ninjaPackages = (catalog.ninjaCatalog as shared.CatalogType)[ninjaVer];
    if (!ninjaPackages)
      throw Error(`Cannot find Ninja version:'${this.requestedNinjaVersion}' in the catalog.`);
    const ninjaPackage = ninjaPackages[targetArchPlat];
    if (!ninjaPackage)
      throw Error(`Cannot find Ninja version:'${this.requestedNinjaVersion}' in the catalog for the '${targetArchPlat}' platform.`);

    await this.get(cmakePackage, ninjaPackage);
  }

  private static matchRange(theCatalog: shared.CatalogType, range: string, toolName: string): string {
    const targetArchPlat = shared.getArchitecturePlatform();
    try {
      const packages = theCatalog[range];
      if (!packages)
        throw Error(`Cannot find '${toolName}' version '${range}' in the catalog.`);
      const aPackage = packages[targetArchPlat];
      if (!aPackage)
        throw Error(`Cannot find '${toolName}' version '${range}' in the catalog for the '${targetArchPlat}' platform.`);
      // return 'range' itself, this is the case where it is a well defined version.
      return range;
    } catch {
      // Try to use the range to find the version ...
      core.debug(`Collecting semvers list... `);
      const matches: SemVer[] = [];
      Object.keys(theCatalog).forEach(function (release) {
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
    let hashedKey: number, outPath: string;
    let cloudCacheHitKey: string | undefined = undefined;
    let localCacheHit = false;
    let localPath: string | undefined = undefined;

    try {
      core.startGroup(`Computing cache key from the downloads' URLs`);
      // Get an unique output directory name from the URL.
      const inputHash = `${cmakePackage.url}${ninjaPackage.url}`;
      hashedKey = hashCode(inputHash);
      core.info(`Cache key: '${hashedKey}'.`);
      core.debug(`hash('${inputHash}') === '${hashedKey}'`);
      outPath = this.getOutputPath(hashedKey.toString());
      core.info(`Local install root: '${outPath}''.`)
    } finally {
      core.endGroup();
    }

    if (this.useLocalCache) {
      try {
        core.startGroup(`Restoring from local GitHub runner cache using key '${hashedKey}'`);
        localPath = tools.find(ToolsGetter.LocalCacheName,
          ToolsGetter.hashToFakeSemver(hashedKey), process.platform);
        // Silly tool-cache API does return an empty string in case of cache miss.
        localCacheHit = localPath ? true : false;
        core.info(localCacheHit ? "Local cache hit." : "Local cache miss.");
      } finally {
        core.endGroup();
      }
    }

    if (!localCacheHit) {
      if (this.useCloudCache) {
        try {
          core.startGroup(`Restoring from GitHub cloud cache using key '${hashedKey}' into '${outPath}'`);
          cloudCacheHitKey = await this.restoreCache(outPath, hashedKey);
          core.info(cloudCacheHitKey === undefined ? "Cloud cache miss." : "Cloud cache hit.");
        } finally {
          core.endGroup();
        }
      }

      if (cloudCacheHitKey === undefined) {
        await this.downloadTools(cmakePackage, ninjaPackage, outPath);
      }

      localPath = outPath;
    }

    if (!localPath) {
      throw new Error(`Unexpectedly the directory of the tools is not defined`);
    }

    await this.addToolsToPath(localPath, cmakePackage, ninjaPackage);

    if (this.useCloudCache && cloudCacheHitKey === undefined) {
      try {
        core.startGroup(`Saving to GitHub cloud cache using key '${hashedKey}'`);
        if (localCacheHit) {
          core.info("Skipping saving to cloud cache since there was local cache hit for the computed key.");
        }
        else if (cloudCacheHitKey === undefined) {
          await this.saveCache([outPath], hashedKey);
          core.info(`Saved '${outPath}' to the GitHub cache service with key '${hashedKey}'.`);
        } else {
          core.info("Skipping saving to cloud cache since there was a cache hit for the computed key.");
        }
      } finally {
        core.endGroup();
      }
    }

    if (this.useLocalCache && !localCacheHit && localPath) {
      try {
        core.startGroup(`Saving to local cache using key '${hashedKey}' from '${outPath}'`);
        await tools.cacheDir(localPath, ToolsGetter.LocalCacheName,
          ToolsGetter.hashToFakeSemver(hashedKey), process.platform);
        core.info(`Saved '${outPath}' to the local GitHub runner cache with key '${hashedKey}'.`);
      } finally {
        core.endGroup();
      }
    }
  }

  private async addToolsToPath(outPath: string, cmakePackage: shared.PackageInfo, ninjaPackage: shared.PackageInfo): Promise<void> {
    try {
      if (!cmakePackage.fileName) {
        throw new Error("The file name of the CMake archive is required but it is missing!");
      }
      if (!ninjaPackage.fileName) {
        throw new Error("The file name of the Ninja archive is required but it is missing!");
      }

      core.startGroup(`Add CMake and Ninja to PATH`);
      const cmakePath = path.join(outPath, cmakePackage.fileName.replace(cmakePackage.dropSuffix, ''), cmakePackage.binPath);
      const ninjaPath = path.join(outPath, ninjaPackage.fileName.replace(ninjaPackage.dropSuffix, ''));

      core.info(`CMake path: '${cmakePath}'`);
      core.addPath(cmakePath);
      core.info(`Ninja path: '${ninjaPath}'`);
      core.addPath(ninjaPath);

      try {
        core.startGroup(`Validating the installed CMake and Ninja`);
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
  }

  private getOutputPath(subDir: string): string {
    if (!process.env.RUNNER_TEMP)
      throw new Error("Environment variable process.env.RUNNER_TEMP must be set, it is used as destination directory of the cache");
    return path.join(process.env.RUNNER_TEMP, subDir);;
  }

  private async saveCache(paths: string[], key: number): Promise<number | undefined> {
    try {
      return await cache.saveCache(paths, key.toString());
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

  private restoreCache(outPath: string, key: number): Promise<string | undefined> {
    return cache.restoreCache([outPath], key.toString());
  }

  private async downloadTools(
    cmakePackage: shared.PackageInfo, ninjaPackage: shared.PackageInfo,
    outputPath: string): Promise<void> {
    let outPath: string;
    await core.group("Downloading and extracting CMake", async () => {
      const downloaded = await tools.downloadTool(cmakePackage.url);
      await extractFunction[cmakePackage.dropSuffix](downloaded, outputPath);
    });

    await core.group("Downloading and extracting Ninja", async () => {
      const downloaded = await tools.downloadTool(ninjaPackage.url);
      await extractFunction[ninjaPackage.dropSuffix](downloaded, outputPath);
    });
  }

  private static hashToFakeSemver(hashedKey: number): string {
    return `${hashedKey}.0.0`;
  }
}

export async function main(): Promise<void> {
  try {
    const cmakeGetter: ToolsGetter = new ToolsGetter(
      core.getInput('cmakeVersion'), core.getInput('ninjaVersion'),
      core.getBooleanInput('useCloudCache'), core.getBooleanInput('useLocalCache'));
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
