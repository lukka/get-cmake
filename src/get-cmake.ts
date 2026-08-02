// Copyright (c) 2020-2021-2022-2023-2024-2025 Luca Cappa
// Released under the term specified in file LICENSE.txt

// SPDX short identifier: MIT

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as io from '@actions/io';
import * as tools from '@actions/tool-cache';
import * as path from 'path';
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as crypto from 'crypto';
import { SemVer, maxSatisfying } from 'semver';
import * as catalog from './releases-catalog'
import * as shared from './releases-collector'

const extractFunction: { [key: string]: { (url: string, outputPath: string): Promise<string> } } = {
  '.tar.gz': tools.extractTar,
  '.zip': tools.extractZip
}

export class ToolsGetter {
  private static readonly CMakeDefaultVersion = 'latest';
  private static readonly NinjaDefaultVersion = 'latest';
  // Namespace of the cache key. It must be changed whenever the content of a cache entry,
  // or the way its key is computed, changes in a way that makes the existing entries
  // unsuitable for reuse.
  private static readonly CacheKeySchema = "get-cmake-sha256-verified-v1";
  // The name under which the tool-cache indexes the local entries. It carries the schema
  // so that the entries of this schema live in a directory tree of their own: the ones
  // stored by the releases predating the checksum verification, which hold an archive
  // nobody ever verified, are indexed under the previous name and can never be found.
  private static readonly LocalCacheName = `cmakeninja-${ToolsGetter.CacheKeySchema}`;
  // Number of hexadecimal characters of the digest used to name the installation
  // directory. 128 bits are collision resistant, while keeping the path short enough not
  // to contribute to the path length limit of Windows.
  private static readonly OutputPathDigestLength = 32;
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
    core.debug(`matchRange(${theCatalog}, ${range}, ${toolName})<<`);
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
    } catch (error: any) {
      core.debug(error?.message);
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
      core.debug(`matchRange(${theCatalog}, ${range}, ${toolName})>>`);
      return match.version;
    }
  }

  private async get(cmakePackage: shared.PackageInfo, ninjaPackage: shared.PackageInfo): Promise<void> {
    let cacheKey: string, keyDigest: string, outPath: string;
    let cloudCacheHitKey: string | undefined = undefined;
    let localCacheHit = false;
    let localPath: string | undefined = undefined;

    // A cache hit skips downloadTools() altogether, hence the verification it performs
    // would be bypassed: refuse an unverifiable package before any cache is looked up.
    const cmakeSha256 = ToolsGetter.getExpectedSha256(cmakePackage, 'CMake');
    const ninjaSha256 = ToolsGetter.getExpectedSha256(ninjaPackage, 'Ninja');

    try {
      core.startGroup(`Computing cache key from the downloads' URLs and checksums`);
      // Get an unique key from the URLs and the expected checksums. The schema is kept
      // verbatim in the key and the rest is a collision resistant digest, hence the keys
      // of this schema form a namespace of their own: the entries stored by the releases
      // predating the checksum verification - which may hold an archive nobody ever
      // verified - can never be hit, whatever key they were stored under. The separators
      // keep the fields unambiguous, so that distinct inputs cannot produce the same
      // digest.
      const keyInput =
        `${ToolsGetter.CacheKeySchema}|${cmakePackage.url}|${cmakeSha256}|${ninjaPackage.url}|${ninjaSha256}`;
      keyDigest = crypto.createHash('sha256').update(keyInput).digest('hex');
      cacheKey = `${ToolsGetter.CacheKeySchema}-${keyDigest}`;
      core.info(`Cache key: '${cacheKey}'.`);
      core.debug(`sha256('${keyInput}') === '${keyDigest}'`);
      outPath = this.getOutputPath(keyDigest.slice(0, ToolsGetter.OutputPathDigestLength));
      core.info(`Local install root: '${outPath}''.`)
    } finally {
      core.endGroup();
    }

    if (this.useLocalCache) {
      try {
        core.startGroup(`Restoring from local GitHub runner cache using key '${cacheKey}'`);
        localPath = tools.find(ToolsGetter.LocalCacheName,
          ToolsGetter.digestToVersion(keyDigest), process.platform);
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
          core.startGroup(`Restoring from GitHub cloud cache using key '${cacheKey}' into '${outPath}'`);
          cloudCacheHitKey = await this.restoreCache(outPath, cacheKey);
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
        core.startGroup(`Saving to GitHub cloud cache using key '${cacheKey}'`);
        if (localCacheHit) {
          core.info("Skipping saving to cloud cache since there was local cache hit for the computed key.");
        }
        else if (cloudCacheHitKey === undefined) {
          await this.saveCache([outPath], cacheKey);
          core.info(`Saved '${outPath}' to the GitHub cache service with key '${cacheKey}'.`);
        } else {
          core.info("Skipping saving to cloud cache since there was a cache hit for the computed key.");
        }
      } finally {
        core.endGroup();
      }
    }

    if (this.useLocalCache && !localCacheHit && localPath) {
      try {
        core.startGroup(`Saving to local cache using key '${cacheKey}' from '${outPath}'`);
        await tools.cacheDir(localPath, ToolsGetter.LocalCacheName,
          ToolsGetter.digestToVersion(keyDigest), process.platform);
        core.info(`Saved '${outPath}' to the local GitHub runner cache with key '${cacheKey}'.`);
      } finally {
        core.endGroup();
      }
    }
  }

  private isWindows(): boolean {
    return (process.platform === 'win32');
  }

  // Some ninja archives for macOS contain the ninja executable named after 
  // the package name rather than 'ninja'.
  private async fixUpNinjaExeName(ninjaPath: string): Promise<void> {
    core.debug(`fixUpNinjaExeName(${ninjaPath})<<<`);
    try {
      const ninjaExeFileName = this.isWindows() ? 'ninja.exe' : 'ninja';
      const files = await fs.readdir(ninjaPath);
      for (const file of files) {
        core.debug(`Processing: '${file}'.`);
        if (file.toLowerCase() !== ninjaExeFileName && file.toLowerCase().startsWith('ninja')) {
          core.debug(`Renaming: '${file}'.`);
          // If not an executable, skip it
          const ninjaFullPath = path.join(ninjaPath, file);
          try { await fs.access(ninjaFullPath, fs.constants.X_OK); } catch { continue; };
          const ninjaExeFullPath = path.join(ninjaPath, ninjaExeFileName);
          await fs.rename(ninjaFullPath, ninjaExeFullPath);
          core.debug(`Renamed '${ninjaFullPath}' to '${ninjaExeFullPath}'.`);
          return;
        }
      }
      core.debug(`No rename occurred.`);
    } catch (err: any) {
      const error: Error = err as Error;
      core.warning(`Error while trying to fix up ninja executable name at '${ninjaPath}': ` +
        err?.message ?? "unknown error");
    }
    core.debug(`fixUpNinjaExeName(${ninjaPath})>>>`);
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
      core.setOutput('cmake-path', cmakePath);
      core.info(`Ninja path: '${ninjaPath}'`);
      core.addPath(ninjaPath);
      core.setOutput('ninja-path', ninjaPath);
      await this.fixUpNinjaExeName(ninjaPath);

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

  private restoreCache(outPath: string, key: string): Promise<string | undefined> {
    return cache.restoreCache([outPath], key);
  }

  private async extract(archiveSuffix: string, downloaded: string, outputPath: string): Promise<string> {
    try {
      await extractFunction[archiveSuffix](downloaded, outputPath);
    } catch (exception) {
      // Fix up the downloaded archive extension for https://github.com/actions/toolkit/issues/1179
      if (this.isWindows()) {
        const zipExtension = ".zip";
        if (path.extname(downloaded) !== zipExtension) {
          const downloadedZip = downloaded + zipExtension;
          await fs.rename(downloaded, downloadedZip);
          return await extractFunction[archiveSuffix](downloadedZip, outputPath);
        }
      }

      throw exception;
    }

    return downloaded;
  }

  private async verifyChecksum(filePath: string, expectedSha256: string, toolName: string, url: string): Promise<void> {
    const hash = await new Promise<string>((resolve, reject) => {
      const hasher = crypto.createHash('sha256');
      const stream = fsSync.createReadStream(filePath);
      stream.on('data', (chunk) => hasher.update(chunk));
      stream.on('end', () => resolve(hasher.digest('hex')));
      stream.on('error', reject);
    });
    if (hash.toLowerCase() !== expectedSha256.toLowerCase()) {
      // Do not leave an archive that failed verification on disk.
      await fs.rm(filePath, { force: true });
      throw new Error(
        `SHA-256 checksum mismatch for ${toolName} downloaded from '${url}'!\n` +
        `  Expected: ${expectedSha256.toLowerCase()}\n` +
        `  Got:      ${hash}`
      );
    }
    core.info(`SHA-256 checksum verified for ${toolName}.`);
  }

  /**
   * Return the SHA-256 digest the archive of 'pkg' must be verified against.
   * @throws when the catalog does not carry one: an archive whose integrity cannot be
   * verified must never be installed.
   */
  private static getExpectedSha256(pkg: shared.PackageInfo, toolName: string): string {
    if (!pkg.sha256) {
      throw new Error(`SHA-256 checksum not available for ${toolName} at '${pkg.url}'; refusing to install an unverifiable archive.`);
    }
    return pkg.sha256;
  }

  private async downloadTools(
    cmakePackage: shared.PackageInfo, ninjaPackage: shared.PackageInfo,
    outputPath: string): Promise<void> {
    await core.group("Downloading and extracting CMake", async () => {
      // Bail out before spending bandwidth on an archive that could not be verified anyway.
      const expectedSha256 = ToolsGetter.getExpectedSha256(cmakePackage, 'CMake');
      const downloaded = await tools.downloadTool(cmakePackage.url);
      await this.verifyChecksum(downloaded, expectedSha256, 'cmake', cmakePackage.url);
      await this.extract(cmakePackage.dropSuffix, downloaded, outputPath);
    });

    await core.group("Downloading and extracting Ninja", async () => {
      const expectedSha256 = ToolsGetter.getExpectedSha256(ninjaPackage, 'Ninja');
      const downloaded = await tools.downloadTool(ninjaPackage.url);
      await this.verifyChecksum(downloaded, expectedSha256, 'ninja', ninjaPackage.url);
      await this.extract(ToolsGetter.getArchiveExtension(ninjaPackage.fileName), downloaded, outputPath);
    });
  }

  private static getArchiveExtension(archivePath?: string): string {
    if (!archivePath) {
      throw new Error(`Invalid archivePath passed to getArchiveExtension()`);
    }
    const urlLower = archivePath.toLowerCase();
    if (urlLower.endsWith('.tar.gz')) {
      return '.tar.gz';
    } else if (urlLower.endsWith('.zip')) {
      return '.zip';
    } else {
      throw new Error(`Unknown archive extension for '${archivePath}'`);
    }
  }

  private static digestToVersion(keyDigest: string): string {
    // The tool-cache indexes a local entry by a semver version, hence the digest cannot be
    // used as it is. Three distinct 32 bit slices of it are encoded as the numeric
    // components, which keeps 96 bits of it: enough for distinct inputs never to share an
    // entry. A truncation to a single 32 bit number, as done before the checksums were
    // verified, would not be.
    const slice = (index: number): number =>
      parseInt(keyDigest.slice(index * 8, (index * 8) + 8), 16);
    return `${slice(0)}.${slice(1)}.${slice(2)}`;
  }
}

function forceExit(exitCode: number) {
  // work around for:
  //  - https://github.com/lukka/get-cmake/issues/136
  //  - https://github.com/nodejs/node/issues/47228

  // Avoid this workaround when running mocked unit tests.
  if (process.env.JEST_WORKER_ID)
    return;

  process.exit(exitCode);
}

export async function main(): Promise<void> {
  try {
    const cmakeGetter: ToolsGetter = new ToolsGetter(
      core.getInput('cmakeVersion'), core.getInput('ninjaVersion'),
      core.getBooleanInput('useCloudCache'), core.getBooleanInput('useLocalCache'));
    await cmakeGetter.run();
    core.info('get-cmake action execution succeeded');
    process.exitCode = 0;
    forceExit(0);
  } catch (err) {
    const error: Error = err as Error;
    if (error?.stack) {
      core.debug(error.stack);
    }
    const errorAsString = (err ?? "undefined error").toString();
    core.setFailed(`get-cmake action execution failed: '${errorAsString}'`);
    process.exitCode = -1000;
    
    forceExit(-1000);
  }
}
