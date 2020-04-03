import * as tools from '@actions/tool-cache'
import * as core from '@actions/core'
import * as path from 'path';

interface PackageInfo {
  url: string;
  binPath: string;
}

export class CMakeGetter {
  private static readonly linux_x64: string = "https://github.com/Kitware/CMake/releases/download/v3.17.0/cmake-3.17.0-Linux-x86_64.tar.gz";
  private static readonly win_x64: string = 'https://github.com/Kitware/CMake/releases/download/v3.17.0/cmake-3.17.0-win64-x64.zip';
  private static readonly macos: string = "https://github.com/Kitware/CMake/releases/download/v3.17.0/cmake-3.17.0-Darwin-x86_64.tar.gz";
  private static readonly Version = '3.17.0';
  private static readonly map: { [key: string]: PackageInfo } = {
    "linux": { url: CMakeGetter.linux_x64, binPath: 'bin/' },
    "win32": { url: CMakeGetter.win_x64, binPath: 'bin/' },
    "darwin": { url: CMakeGetter.macos, binPath: "CMake.app/Contents/bin/" }
  };

  public async run(): Promise<void> {
    const data = CMakeGetter.map[process.platform];
    const cmakePath = await this.get(data);
    await tools.cacheDir(cmakePath, 'cmake', CMakeGetter.Version);
  }

  private async get(data: PackageInfo): Promise<string> {
    let extractedPath: string;
    const downloaded = await tools.downloadTool(data.url);
    let suffixToDrop: string;
    if (data.url.endsWith(".zip")) {
      extractedPath = await tools.extractZip(downloaded, process.env.RUNNER_TEMP);
      suffixToDrop = ".zip";
    }
    else if (data.url.endsWith("tar.gz")) {
      extractedPath = await tools.extractTar(downloaded, process.env.RUNNER_TEMP);
      suffixToDrop = ".tar.gz";
    }
    else if (data.url.endsWith("7z")) {
      extractedPath = await tools.extract7z(downloaded, process.env.RUNNER_TEMP);
      suffixToDrop = ".7z";
    }
    else
      throw new Error(`Unsupported archive format: ${data.url}`);

    const addr = new URL(data.url);
    const dirName = path.basename(addr.pathname);
    core.addPath(path.join(extractedPath, dirName.replace(suffixToDrop, ''), data.binPath));
    return extractedPath;
  }
}