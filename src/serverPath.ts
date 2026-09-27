import { posix, win32 } from 'node:path';

export interface ServerSearchOptions {
  configuredPath: string;
  extensionPath: string;
  cwd: string;
  platform: NodeJS.Platform;
  pathEnv: string;
  fileExists: (path: string) => boolean;
}

export type ServerResolution =
  | { command: string; source: 'configured' | 'bundled' | 'path' }
  | { source: 'missing'; error: string };

export function resolveCompilerPath(
  configuredPath: string,
  platform: NodeJS.Platform,
  fileExists: (path: string) => boolean,
  pathEnv: string,
  cwd: string
): { command: string } | { error: string } {
  const configured = configuredPath.trim();
  const path = platform === 'win32' ? win32 : posix;
  if (configured) {
    if (!path.isAbsolute(configured)) {
      return { error: 'ck.compiler.path must be an absolute path.' };
    }
    if (!fileExists(configured)) {
      return { error: 'Configured CK compiler not found: ' + configured };
    }
    return { command: configured };
  }
  const executable = platform === 'win32' ? 'ckc.exe' : 'ckc';
  for (const directory of pathEnv.split(platform === 'win32' ? ';' : ':')) {
    if (!directory) continue;
    const candidate = path.resolve(cwd, directory, executable);
    if (fileExists(candidate)) return { command: candidate };
  }
  return { error: 'Native CK compiler not found on PATH. Set ck.compiler.path.' };
}

export function resolveServer(options: ServerSearchOptions): ServerResolution {
  const windows = options.platform === 'win32';
  const path = windows ? win32 : posix;
  const configured = options.configuredPath.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      return { source: 'missing', error: 'ck.server.path must be an absolute path.' };
    }
    return options.fileExists(configured)
      ? { command: configured, source: 'configured' }
      : { source: 'missing', error: 'Configured CK server not found: ' + configured };
  }

  const executable = windows ? 'ckc.exe' : 'ckc';
  const bundled = path.join(options.extensionPath, 'bin', executable);
  if (options.fileExists(bundled)) {
    return { command: bundled, source: 'bundled' };
  }

  for (const directory of options.pathEnv.split(windows ? ';' : ':')) {
    if (!directory) continue;
    const candidate = path.resolve(options.cwd, directory, executable);
    if (options.fileExists(candidate)) {
      return { command: candidate, source: 'path' };
    }
  }
  return { source: 'missing', error: 'CK server not found. Set ck.server.path or install ckc.' };
}
