// Copyright (c) 2022-2023-2024 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as semver from 'semver'

const windowsPlatform = 'win32';
const windowsArmPlatform = 'win32-arm64';
const linuxX64Platform = 'linux';
const linuxX86Platform = "linux";
const linuxArmPlatform = 'linux-arm64';
const macosPlatform = 'darwin';

export function getArchitecturePlatform(): string {
  if (process.platform === 'linux' && process.arch === 'arm64')
    return linuxArmPlatform;
  else if (process.platform === 'win32' && process.arch === 'arm64')
    return windowsArmPlatform;
  return process.platform;
}

export interface PackageInfo {
  url: string;
  fileName?: string;
  binPath: string;
  dropSuffix: string;
}

export interface ReleaseFilter {
  suffix: string;
  binPath: string;
  dropSuffix: string;
  platform: string;
};

export const ReleasesCatalogFileName = "releases-catalog.ts";

export type CatalogType = Record<string, { [platform: string]: PackageInfo }>

export interface VersionSelector {
  releaseKey: string;
  prereleaseAccepted: boolean;
}

export interface MostRecentVersion { mostRecentVersion: semver.SemVer | null };

export type MostRecentReleases = Map<string, Map<string, MostRecentVersion>>;

export type Asset = { name: string; browser_download_url: string; tag_name: string };

export class NinjaFilters {
  private static readonly linuxArmFilters: ReleaseFilter[] = [{
    binPath: '',
    dropSuffix: ".tar.gz",
    suffix: "aarch64-linux-gnu.tar.gz",
    platform: linuxArmPlatform,
  }];
  private static readonly linuxFilters: ReleaseFilter[] = [{
    binPath: '',
    dropSuffix: ".tar.gz",
    suffix: "x86_64-linux-gnu.tar.gz",
    platform: linuxX64Platform,
  }];
  private static readonly windowsFilters: ReleaseFilter[] = [{
    binPath: '',
    dropSuffix: ".zip",
    suffix: "x86_64-pc-windows-msvc.zip",
    platform: windowsPlatform,
  }];
  private static readonly windowsArmFilters: ReleaseFilter[] = [{
    binPath: '',
    dropSuffix: ".zip",
    suffix: "arm64-pc-windows-msvc.zip",
    platform: windowsArmPlatform,
  }];
  private static readonly macosFilters: ReleaseFilter[] = [{
    binPath: "",
    dropSuffix: '.tar.gz',
    suffix: "universal-apple-darwin.tar.gz",
    platform: macosPlatform,
  }, {
    binPath: "",
    dropSuffix: 'ninja-linux-aarch64.zip',
    suffix: "ninja-linux-aarch64.zip",
    platform: linuxArmPlatform,
  }, {
    binPath: "",
    dropSuffix: 'ninja-linux.zip',
    suffix: "ninja-linux.zip",
    platform: linuxX64Platform,
  }, {
    binPath: "",
    dropSuffix: 'ninja-win.zip',
    suffix: "ninja-win.zip",
    platform: windowsPlatform,
  }, {
    binPath: "",
    dropSuffix: 'ninja-winarm64.zip',
    suffix: "ninja-winarm64.zip",
    platform: windowsArmPlatform,
  }, {
    binPath: "",
    dropSuffix: 'ninja-mac.zip',
    suffix: "ninja-mac.zip",
    platform: macosPlatform,
  }];

  public static readonly allFilters: ReleaseFilter[] =
    [...NinjaFilters.linuxFilters, ...NinjaFilters.macosFilters, ...NinjaFilters.windowsFilters,
    ...NinjaFilters.linuxArmFilters, ...NinjaFilters.windowsArmFilters];
}

export class CMakeFilters {
  private static readonly linuxArmFilters: ReleaseFilter[] = [{
    binPath: 'bin/',
    dropSuffix: ".tar.gz",
    suffix: "linux-aarch64.tar.gz",
    platform: linuxArmPlatform,
  }];
  private static readonly linuxFilters: ReleaseFilter[] = [{
    binPath: 'bin/',
    dropSuffix: ".tar.gz",
    suffix: "linux-x86_64.tar.gz",
    platform: linuxX64Platform,
  }, {
    binPath: 'bin/',
    dropSuffix: ".tar.gz",
    suffix: "Linux-i386.tar.gz",
    platform: linuxX86Platform,
  }];
  private static readonly windowsFilters: ReleaseFilter[] = [
    {
      binPath: 'bin/',
      dropSuffix: ".zip",
      suffix: "windows-arm64.zip",
      platform: windowsArmPlatform,
    }, {
      binPath: 'bin/',
      dropSuffix: ".zip",
      suffix: "windows-x86_64.zip",
      platform: windowsPlatform,
    }, {
      binPath: 'bin/',
      dropSuffix: ".zip",
      suffix: "win64-x64.zip",
      platform: windowsPlatform,
    }, {
      binPath: 'bin/',
      dropSuffix: ".zip",
      suffix: "win32-x86.zip",
      platform: windowsPlatform,
    }];
  private static readonly macosFilters: ReleaseFilter[] = [{
    binPath: "CMake.app/Contents/bin/",
    dropSuffix: '.tar.gz',
    suffix: "macos-universal.tar.gz",
    platform: macosPlatform,
  }, {
    binPath: "CMake.app/Contents/bin/",
    dropSuffix: '.tar.gz',
    suffix: "Darwin-x86_64.tar.gz",
    platform: macosPlatform,
  }, {
    binPath: "CMake.app/Contents/bin/",
    dropSuffix: '.tar.gz',
    suffix: "Darwin64-universal.tar.gz",
    platform: macosPlatform,
  }];

  public static readonly allFilters: ReleaseFilter[] =
    [...CMakeFilters.linuxFilters, ...CMakeFilters.macosFilters, ...CMakeFilters.windowsFilters,
    ...CMakeFilters.linuxArmFilters];
}

export class ReleasesCollector {
  static readonly versionSelectors: VersionSelector[] = [
    { releaseKey: "latest", prereleaseAccepted: false },
    { releaseKey: "latestrc", prereleaseAccepted: true }];

  public constructor(private map: CatalogType, private mostRecentReleases: MostRecentReleases, private filters: ReleaseFilter[]) {
  }

  public track(assets: Asset[]): void {
    try {
      let releaseHit: boolean;
      for (const asset of assets) {
        releaseHit = false;
        for (const filter of this.filters) {
          if (asset.name.trim().toLowerCase().endsWith(filter.suffix.toLowerCase())) {
            try {
              const version = semver.parse(asset.tag_name) || semver.coerce(asset.tag_name);
              const release = {
                url: asset.browser_download_url,
                fileName: asset.name,
                binPath: filter.binPath,
                dropSuffix: filter.dropSuffix,
              };
              if (version) {
                const currentVersion = { mostRecentVersion: version };
                this.map[version.version] ?? (this.map[version.version] = {});
                this.map[version.version][filter.platform] = release;
                releaseHit = true;

                // Track the latest releases.
                for (const key of ReleasesCollector.versionSelectors) {
                  // This code makes little sense, anything better is welcome!
                  const v = this.mostRecentReleases.get(key.releaseKey);
                  v ?? (this.mostRecentReleases.set(key.releaseKey, new Map()));

                  const latest = this.mostRecentReleases.get(key.releaseKey)?.get(filter.platform);
                  const isCurrentVersionPrerelease = ((version.prerelease?.length ?? 0) > 0) ? true : false;
                  if ((key.prereleaseAccepted === isCurrentVersionPrerelease) &&
                    (!latest || (latest.mostRecentVersion && semver.compare(version, latest.mostRecentVersion) >= 0))) {
                    this.mostRecentReleases.get(key.releaseKey)?.set(filter.platform,
                      currentVersion);

                    // Ensure existence of the instance for the given key.
                    let v = this.map[key.releaseKey];
                    v ?? (v = (this.map[key.releaseKey] = {}));
                    v[filter.platform] = this.map[currentVersion.mostRecentVersion.version][filter.platform];
                  }
                }
              }
            }
            catch (err: any) {
              console.log("Warning: " + err);
              continue;
            }
          }
        }

        if (releaseHit === false) {
          console.log(`Skipping ${asset.name}`);
        }
      }
    }
    catch (err: any) {
      console.log("Fatal error: " + err);
      throw err;
    }
  }
}
