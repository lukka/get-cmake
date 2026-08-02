// Copyright (c) 2025 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as cache from '@actions/cache';
import * as tools from '@actions/tool-cache';
import { ToolsGetter } from '../src/get-cmake';
import { hashCode } from '../src/utils';
import * as catalog from '../src/releases-catalog';
import * as shared from '../src/releases-collector';

// 1 minute
jest.setTimeout(60 * 1000)

const aValidSha256 = 'a'.repeat(64);

function aPackage(sha256?: string): shared.PackageInfo {
    return {
        url: 'https://example.com/a-package.zip',
        fileName: 'a-package.zip',
        binPath: 'bin/',
        dropSuffix: '.zip',
        sha256: sha256,
    };
}

test('verifyChecksum succeeds when hash matches', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-test-'));
    try {
        const testFile = path.join(tmpDir, 'testfile.bin');
        const content = Buffer.from('hello world');
        await fs.writeFile(testFile, content);
        const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

        const getter = new ToolsGetter();
        // Access the private method via 'as any'
        await expect((getter as any).verifyChecksum(testFile, expectedHash, 'test-tool', 'https://example.com/a.zip'))
            .resolves.toBeUndefined();
        // The verified file must be left in place for the extraction step.
        await expect(fs.access(testFile)).resolves.toBeUndefined();
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('verifyChecksum throws and deletes the archive on hash mismatch', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-test-'));
    try {
        const testFile = path.join(tmpDir, 'testfile.bin');
        await fs.writeFile(testFile, Buffer.from('hello world'));

        const getter = new ToolsGetter();
        await expect((getter as any).verifyChecksum(testFile, aValidSha256, 'test-tool', 'https://example.com/a.zip'))
            .rejects.toThrow(/SHA-256 checksum mismatch for test-tool downloaded from 'https:\/\/example.com\/a.zip'/);
        // An archive that failed verification must not be left behind.
        await expect(fs.access(testFile)).rejects.toThrow();
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('downloadTools refuses to download CMake without a known checksum', async () => {
    const downloadTool = jest.spyOn(tools, 'downloadTool');
    const getter = new ToolsGetter();
    await expect((getter as any).downloadTools(aPackage(undefined), aPackage(aValidSha256), 'anOutputPath'))
        .rejects.toThrow(/SHA-256 checksum not available for CMake/);
    // The download must not even be attempted.
    expect(downloadTool).toBeCalledTimes(0);
});

test('downloadTools refuses to download Ninja without a known checksum', async () => {
    const downloadTool = jest.spyOn(tools, 'downloadTool').mockResolvedValue('aDownloadedFile');
    const extract = jest.spyOn(ToolsGetter.prototype as any, 'extract').mockResolvedValue('aDownloadedFile');
    const verifyChecksum = jest.spyOn(ToolsGetter.prototype as any, 'verifyChecksum').mockResolvedValue(undefined);
    const getter = new ToolsGetter();
    await expect((getter as any).downloadTools(aPackage(aValidSha256), aPackage(undefined), 'anOutputPath'))
        .rejects.toThrow(/SHA-256 checksum not available for Ninja/);
    // Only CMake must have been downloaded, verified and extracted.
    expect(downloadTool).toBeCalledTimes(1);
    expect(verifyChecksum).toBeCalledTimes(1);
    expect(extract).toBeCalledTimes(1);
});

test('the cache key changes when the expected checksum changes', async () => {
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), crypto.randomBytes(16).toString('hex'));
    const keys: string[] = [];
    jest.spyOn(cache, 'restoreCache').mockImplementation(async (_paths: string[], key: string) => {
        keys.push(key);
        return undefined;
    });
    jest.spyOn(cache, 'saveCache').mockResolvedValue(0);
    jest.spyOn(ToolsGetter.prototype as any, 'downloadTools').mockResolvedValue(undefined);
    jest.spyOn(ToolsGetter.prototype as any, 'addToolsToPath').mockResolvedValue(undefined);

    const getter = new ToolsGetter();
    await (getter as any).get(aPackage(aValidSha256), aPackage(aValidSha256));
    await (getter as any).get(aPackage('b'.repeat(64)), aPackage(aValidSha256));

    expect(keys).toHaveLength(2);
    // Cache entries stored before the checksums were known must not be reused.
    expect(keys[0]).not.toEqual(keys[1]);
});

test('the cache key is namespaced to never collide with the entries of the legacy releases', async () => {
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), crypto.randomBytes(16).toString('hex'));
    const keys: string[] = [];
    jest.spyOn(cache, 'restoreCache').mockImplementation(async (_paths: string[], key: string) => {
        keys.push(key);
        return undefined;
    });
    jest.spyOn(cache, 'saveCache').mockResolvedValue(0);
    jest.spyOn(ToolsGetter.prototype as any, 'downloadTools').mockResolvedValue(undefined);
    jest.spyOn(ToolsGetter.prototype as any, 'addToolsToPath').mockResolvedValue(undefined);

    const cmakePackage = aPackage(aValidSha256);
    const ninjaPackage = aPackage(aValidSha256);
    await (new ToolsGetter() as any).get(cmakePackage, ninjaPackage);

    expect(keys).toHaveLength(1);
    // The schema is carried verbatim by the key, and the rest of it is a collision
    // resistant digest. Merely prefixing the input of hashCode() would not have namespaced
    // anything: its value is truncated to a signed 32 bit integer, hence a legacy key and
    // a new one could well be the same string.
    expect(keys[0]).toMatch(/^get-cmake-sha256-verified-v1-[0-9a-f]{64}$/);
    // The key the releases predating the checksum verification would have computed for the
    // very same packages: their entries hold archives nobody ever verified. Being the
    // decimal representation of a number, it cannot match the shape asserted above, no
    // matter which packages it was computed from.
    const legacyKey = hashCode(`${cmakePackage.url}${ninjaPackage.url}`).toString();
    expect(legacyKey).toMatch(/^-?\d+$/);
    expect(keys[0]).not.toEqual(legacyKey);
});

test('the local tool-cache entries are namespaced and keyed by the whole digest', async () => {
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), crypto.randomBytes(16).toString('hex'));
    const find = jest.spyOn(tools, 'find').mockReturnValue('');
    const cacheDir = jest.spyOn(tools, 'cacheDir').mockResolvedValue('aCachedDir');
    jest.spyOn(ToolsGetter.prototype as any, 'downloadTools').mockResolvedValue(undefined);
    jest.spyOn(ToolsGetter.prototype as any, 'addToolsToPath').mockResolvedValue(undefined);

    await (new ToolsGetter(undefined, undefined, false, true) as any)
        .get(aPackage(aValidSha256), aPackage(aValidSha256));

    // The tool-cache indexes an entry by name and version. The name holds the schema, so
    // that the entries stored by the releases predating the checksum verification - which
    // are indexed under 'cmakeninja' - can never be found.
    expect(find).toBeCalledTimes(1);
    const [toolName, version] = find.mock.calls[0];
    expect(toolName).toBe('cmakeninja-get-cmake-sha256-verified-v1');
    // The version encodes 96 bits of the digest, rather than the single 32 bit value the
    // key used to be truncated to.
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(version.split('.').every(part => Number(part) <= 0xffffffff)).toBe(true);
    // The entry is stored back under the very same name and version it is looked up by.
    expect(cacheDir).toBeCalledWith(expect.any(String), toolName, version, process.platform);
});

test('get refuses an unverifiable package before looking up any cache', async () => {
    process.env.RUNNER_TEMP = path.join(os.tmpdir(), crypto.randomBytes(16).toString('hex'));
    const find = jest.spyOn(tools, 'find').mockReturnValue('aLocalCacheHit');
    const restoreCache = jest.spyOn(cache, 'restoreCache').mockResolvedValue('aCloudCacheHit');
    const downloadTools = jest.spyOn(ToolsGetter.prototype as any, 'downloadTools').mockResolvedValue(undefined);
    const addToolsToPath = jest.spyOn(ToolsGetter.prototype as any, 'addToolsToPath').mockResolvedValue(undefined);

    const getter = new ToolsGetter(undefined, undefined, true, true);
    await expect((getter as any).get(aPackage(undefined), aPackage(aValidSha256)))
        .rejects.toThrow(/SHA-256 checksum not available for CMake/);

    // Neither cache must be consulted: an entry stored for an unverifiable package would
    // otherwise be added to the PATH without ever reaching downloadTools().
    expect(find).toBeCalledTimes(0);
    expect(restoreCache).toBeCalledTimes(0);
    expect(downloadTools).toBeCalledTimes(0);
    expect(addToolsToPath).toBeCalledTimes(0);
});

test('every catalog entry provides a SHA-256 checksum', () => {
    // The action refuses to extract an archive it cannot verify: a catalog entry without
    // a checksum would make the requested version unusable.
    const catalogs: [string, shared.CatalogType][] = [
        ['cmake', catalog.cmakeCatalog as shared.CatalogType],
        ['ninja', catalog.ninjaCatalog as shared.CatalogType]];
    const missing: string[] = [];
    let count = 0;
    for (const [toolName, theCatalog] of catalogs) {
        for (const version of Object.keys(theCatalog)) {
            for (const platform of Object.keys(theCatalog[version])) {
                count++;
                const sha256 = theCatalog[version][platform].sha256;
                if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256))
                    missing.push(`${toolName} ${version} (${platform})`);
            }
        }
    }
    expect(missing).toEqual([]);
    expect(count).toBeGreaterThan(0);
});
