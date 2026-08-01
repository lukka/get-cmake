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
