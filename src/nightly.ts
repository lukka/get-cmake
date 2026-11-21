import * as tools from '@actions/tool-cache';
import * as fs from 'fs/promises';
import { CMakeFilters, PackageInfo } from './releases-collector';

const nightlyBaseUrl = 'https://cmake.org/files/dev/';

interface NightlyManifest {
  files: { name: string; class: string }[];
  hashFiles: { name: string; algorithm: string[] }[];
}

async function downloadText(url: string): Promise<string> {
  const downloaded = await tools.downloadTool(url);
  try {
    return await fs.readFile(downloaded, 'utf8');
  } finally {
    await fs.rm(downloaded, { force: true });
  }
}

function nightlyUrl(fileName: string): string {
  if (!/^cmake-[a-zA-Z0-9._+-]+$/.test(fileName)) {
    throw new Error(`Invalid CMake nightly file name: '${fileName}'.`);
  }
  return nightlyBaseUrl + fileName;
}

export async function getNightlyCMakePackage(platform: string): Promise<PackageInfo> {
  const manifest: NightlyManifest = JSON.parse(
    await downloadText(nightlyBaseUrl + 'cmake-latest-files-v1.json'));
  for (const filter of CMakeFilters.allFilters) {
    if (filter.platform !== platform)
      continue;
    const archive = manifest.files.find(file =>
      file.class === 'archive' && file.name.endsWith(filter.suffix));
    if (!archive)
      continue;

    const url = nightlyUrl(archive.name);
    const hashFile = manifest.hashFiles.find(file => file.algorithm.includes('SHA-256'));
    if (!hashFile)
      throw new Error('SHA-256 checksum file not available for CMake nightly.');
    const checksums = await downloadText(nightlyUrl(hashFile.name));
    const checksum = checksums.split(/\r?\n/).map(line =>
      /^([0-9a-f]{64})[ \t]+\*?(.+)$/i.exec(line))
      .find(match => match?.[2] === archive.name);
    if (!checksum)
      throw new Error(`SHA-256 checksum not available for CMake nightly archive '${archive.name}'.`);

    return {
      url,
      fileName: archive.name,
      binPath: filter.binPath,
      dropSuffix: filter.dropSuffix,
      sha256: checksum[1].toLowerCase(),
    };
  }
  throw new Error(`Cannot find CMake nightly for the '${platform}' platform.`);
}
