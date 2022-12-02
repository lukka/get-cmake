// Copyright (c) 2022 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as semver from 'semver'

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
  private static readonly linuxFilters: ReleaseFilter[] = [{
    binPath: '',
    dropSuffix: ".zip",
    suffix: "linux.zip",
    platform: "linux",
  }];
  private static readonly windowsFilters: ReleaseFilter[] = [{
    binPath: '',
    dropSuffix: ".zip",
    suffix: "win.zip",
    platform: "win32",
  }];
  private static readonly macosFilters: ReleaseFilter[] = [{
    binPath: "",
    dropSuffix: '.zip',
    suffix: "mac.zip",
    platform: "darwin",
  }];

  public static readonly allFilters: ReleaseFilter[] =
    NinjaFilters.linuxFilters.concat(NinjaFilters.macosFilters.concat(NinjaFilters.windowsFilters));
}

export class CMakeFilters {
  private static readonly linuxFilters: ReleaseFilter[] = [{
    binPath: 'bin/',
    dropSuffix: ".tar.gz",
    suffix: "linux-x86_64.tar.gz",
    platform: "linux",
  }];
  private static readonly windowsFilters: ReleaseFilter[] = [{
    binPath: 'bin/',
    dropSuffix: ".zip",
    suffix: "windows-x86_64.zip",
    platform: "win32",
  }, {
    binPath: 'bin/',
    dropSuffix: ".zip",
    suffix: "win64-x64.zip",
    platform: "win32",
  }, {
    binPath: 'bin/',
    dropSuffix: ".zip",
    suffix: "win32-x86.zip",
    platform: "win32",
  }];
  private static readonly macosFilters: ReleaseFilter[] = [{
    binPath: "CMake.app/Contents/bin/",
    dropSuffix: '.tar.gz',
    suffix: "macos-universal.tar.gz",
    platform: "darwin",
  }, {
    binPath: "CMake.app/Contents/bin/",
    dropSuffix: '.tar.gz',
    suffix: "Darwin-x86_64.tar.gz",
    platform: "darwin",
  }];

  public static readonly allFilters: ReleaseFilter[] =
    CMakeFilters.linuxFilters.concat(CMakeFilters.macosFilters.concat(CMakeFilters.windowsFilters));
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
              const version = semver.parse(asset.tag_name);
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
