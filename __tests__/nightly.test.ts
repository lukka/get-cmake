import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as cache from '@actions/cache';
import * as tools from '@actions/tool-cache';
import { getNightlyCMakePackage } from '../src/nightly';
import { ToolsGetter } from '../src/get-cmake';
import * as catalog from '../src/releases-catalog';
import * as shared from '../src/releases-collector';

const baseUrl = 'https://cmake.org/files/dev/';
const sha256 = 'a'.repeat(64);
const platforms = [
    ['linux', 'linux-x86_64.tar.gz', 'bin/', '.tar.gz'],
    ['linux-arm64', 'linux-aarch64.tar.gz', 'bin/', '.tar.gz'],
    ['darwin', 'macos-universal.tar.gz', 'CMake.app/Contents/bin/', '.tar.gz'],
    ['win32', 'windows-x86_64.zip', 'bin/', '.zip'],
    ['win32-arm64', 'windows-arm64.zip', 'bin/', '.zip'],
];
let tmpDir: string;
let manifest: {
    files: { name: string; class: string }[];
    hashFiles: { name: string; algorithm: string[] }[];
};
let checksums: string;
let downloadTool: jest.SpyInstance;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmake-nightly-test-'));
    manifest = {
        files: platforms.map(([, suffix]) => ({
            name: `cmake-4.3.20260101-gabcdef-${suffix}`, class: 'archive',
        })),
        hashFiles: [{
            name: 'cmake-4.3.20260101-gabcdef-SHA-256.txt',
            algorithm: ['sha256', 'SHA-256'],
        }],
    };
    checksums = manifest.files.map(file => `${sha256}  ${file.name}`).join('\n');
    downloadTool = jest.spyOn(tools, 'downloadTool').mockImplementation(async (url: string) => {
        const downloaded = path.join(tmpDir, `download-${downloadTool.mock.calls.length}`);
        if (url === baseUrl + 'cmake-latest-files-v1.json')
            await fs.writeFile(downloaded, JSON.stringify(manifest));
        else if (url === baseUrl + manifest.hashFiles[0]?.name)
            await fs.writeFile(downloaded, checksums);
        else
            throw new Error(`Unexpected download: '${url}'`);
        return downloaded;
    });
});

afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

test.each(platforms)('resolves nightly for %s with a published checksum', async (platform, suffix, binPath, dropSuffix) => {
    const fileName = `cmake-4.3.20260101-gabcdef-${suffix}`;
    await expect(getNightlyCMakePackage(platform)).resolves.toEqual({
        url: baseUrl + fileName, fileName, binPath, dropSuffix, sha256,
    });
    expect(downloadTool.mock.calls.map(call => call[0])).toEqual([
        baseUrl + 'cmake-latest-files-v1.json',
        baseUrl + manifest.hashFiles[0].name,
    ]);
    expect(await fs.readdir(tmpDir)).toEqual([]);
});

test('ignores installers and source archives', async () => {
    manifest.files.unshift(
        { name: 'cmake-installer-linux-x86_64.tar.gz', class: 'installer' },
        { name: 'cmake-4.3.20260101-gabcdef.tar.gz', class: 'archive' });
    expect((await getNightlyCMakePackage('linux')).fileName)
        .toBe('cmake-4.3.20260101-gabcdef-linux-x86_64.tar.gz');
});

test('accepts uppercase hashes, binary checksum markers and CRLF', async () => {
    checksums = `${sha256.toUpperCase()} *${manifest.files[0].name}\r\n`;
    expect((await getNightlyCMakePackage('linux')).sha256).toBe(sha256);
});

test('fails clearly when a platform has no nightly archive', async () => {
    await expect(getNightlyCMakePackage('unsupported')).rejects.toThrow(
        "Cannot find CMake nightly for the 'unsupported' platform");
    expect(downloadTool).toBeCalledTimes(1);
});

test('refuses nightly archives without a SHA-256 hash file', async () => {
    manifest.hashFiles = [];
    await expect(getNightlyCMakePackage('linux')).rejects.toThrow('SHA-256 checksum file not available');
    expect(downloadTool).toBeCalledTimes(1);
});

test.each([
    '',
    `${'a'.repeat(63)}  cmake-4.3.20260101-gabcdef-linux-x86_64.tar.gz`,
    `${sha256}  cmake-other-linux-x86_64.tar.gz`,
    `${sha256}  cmake-4.3.20260101-gabcdef-linux-x86_64.tar.gz.extra`,
])('refuses missing, malformed or mismatched checksums (%s)', async (text) => {
    checksums = text;
    await expect(getNightlyCMakePackage('linux')).rejects.toThrow('SHA-256 checksum not available');
    expect(await fs.readdir(tmpDir)).toEqual([]);
});

test.each(['archive', 'hash file'])('rejects unsafe %s names from the manifest', async (target) => {
    if (target === 'archive')
        manifest.files[0].name = '../cmake-linux-x86_64.tar.gz';
    else
        manifest.hashFiles[0].name = 'https://example.com/checksums.txt';
    await expect(getNightlyCMakePackage('linux')).rejects.toThrow('Invalid CMake nightly file name');
    expect(downloadTool).toBeCalledTimes(1);
});

test('propagates metadata download failures', async () => {
    downloadTool.mockRejectedValue(new Error('Nightly server unavailable'));
    await expect(getNightlyCMakePackage('linux')).rejects.toThrow('Nightly server unavailable');
});

test('removes downloaded metadata when JSON parsing fails', async () => {
    downloadTool.mockImplementation(async () => {
        const downloaded = path.join(tmpDir, 'invalid.json');
        await fs.writeFile(downloaded, '{');
        return downloaded;
    });
    await expect(getNightlyCMakePackage('linux')).rejects.toThrow();
    expect(await fs.readdir(tmpDir)).toEqual([]);
});

test('nightly uses existing caches, refreshes changed builds and preserves Ninja selection', async () => {
    jest.spyOn(shared, 'getArchitecturePlatform').mockReturnValue('linux');
    jest.spyOn(ToolsGetter.prototype as any, 'getOutputPath').mockReturnValue(tmpDir);
    const restoreCache = jest.spyOn(cache, 'restoreCache').mockImplementation(async (_paths, key) => key);
    const downloadTools = jest.spyOn(ToolsGetter.prototype as any, 'downloadTools').mockResolvedValue(undefined);
    const addToolsToPath = jest.spyOn(ToolsGetter.prototype as any, 'addToolsToPath').mockResolvedValue(undefined);
    const getter = new ToolsGetter('nightly', '1.11.1');
    await getter.run();
    await getter.run();
    checksums = checksums.replace(new RegExp(sha256, 'g'), 'b'.repeat(64));
    await getter.run();
    manifest.files[0].name = manifest.files[0].name.replace('20260101', '20260102');
    checksums = `${'b'.repeat(64)}  ${manifest.files[0].name}`;
    await getter.run();

    const keys = restoreCache.mock.calls.map(call => call[1]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(keys[3]).not.toBe(keys[2]);
    expect(downloadTools).not.toBeCalled();
    expect(addToolsToPath).toBeCalledWith(tmpDir,
        expect.objectContaining({ url: baseUrl + manifest.files[0].name }),
        (catalog.ninjaCatalog as shared.CatalogType)['1.11.1']['linux']);
});

test('does not consult caches or install tools when nightly verification metadata is missing', async () => {
    jest.spyOn(shared, 'getArchitecturePlatform').mockReturnValue('linux');
    const get = jest.spyOn(ToolsGetter.prototype as any, 'get');
    checksums = '';
    await expect(new ToolsGetter('nightly').run()).rejects.toThrow('SHA-256 checksum not available');
    expect(get).not.toBeCalled();
});

test.each(['latest', 'latestrc', '3.25.0-rc4', '~3.25.0'])('keeps %s catalog selection offline', async (version) => {
    const get = jest.spyOn(ToolsGetter.prototype as any, 'get').mockResolvedValue(undefined);
    await new ToolsGetter(version).run();
    expect(get).toBeCalledTimes(1);
    expect(downloadTool).not.toBeCalled();
});
