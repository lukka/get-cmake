// Copyright (c) 2024 Luca Cappa
// Released under the term specified in file LICENSE.txt
// SPDX short identifier: MIT

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { ToolsGetter } from '../src/get-cmake';

// 1 minute
jest.setTimeout(60 * 1000)

test('verifyChecksum succeeds when hash matches', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-test-'));
    try {
        const testFile = path.join(tmpDir, 'testfile.bin');
        const content = Buffer.from('hello world');
        await fs.writeFile(testFile, content);
        const expectedHash = crypto.createHash('sha256').update(content).digest('hex');

        const getter = new ToolsGetter();
        // Access the private method via 'as any'
        await expect((getter as any).verifyChecksum(testFile, expectedHash, 'test-tool')).resolves.toBeUndefined();
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('verifyChecksum throws on hash mismatch', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checksum-test-'));
    try {
        const testFile = path.join(tmpDir, 'testfile.bin');
        await fs.writeFile(testFile, Buffer.from('hello world'));
        const wrongHash = 'a'.repeat(64); // wrong SHA-256 hash

        const getter = new ToolsGetter();
        await expect((getter as any).verifyChecksum(testFile, wrongHash, 'test-tool')).rejects.toThrow(
            /SHA-256 checksum mismatch for test-tool/
        );
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test('catalog cmake entries have sha256 for modern versions', async () => {
    const catalog = await import('../src/releases-catalog');
    const cmakeCatalog = catalog.cmakeCatalog as any;

    // Check 'latest' has sha256
    const latestPlatforms = cmakeCatalog['latest'];
    expect(latestPlatforms).toBeDefined();
    for (const platform of Object.keys(latestPlatforms)) {
        const pkg = latestPlatforms[platform];
        expect(pkg.sha256).toBeDefined();
        expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
    }

    // Check a well-known version (3.25.0) has sha256
    const v3250 = cmakeCatalog['3.25.0'];
    expect(v3250).toBeDefined();
    for (const platform of Object.keys(v3250)) {
        const pkg = v3250[platform];
        expect(pkg.sha256).toBeDefined();
        expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
});
