// Copyright (c) 2022 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

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