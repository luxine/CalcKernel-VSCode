import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

function splitRustFlags(environment) {
  if (environment.CARGO_ENCODED_RUSTFLAGS !== undefined) {
    return environment.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean);
  }
  return (environment.RUSTFLAGS ?? '').trim().split(/\s+/).filter(Boolean);
}

function normalizedDirectory(value, pathApi) {
  const directory = pathApi.normalize(pathApi.resolve(value));
  const root = pathApi.parse(directory).root;
  return directory.length > root.length ? directory.replace(/[\\/]+$/, '') : directory;
}

export function compilerBuildEnvironment(environment, platform, workspaceDirectory) {
  const pathApi = platform === 'win32' ? win32 : posix;
  const homeValue = platform === 'win32'
    ? environment.USERPROFILE || environment.HOME || homedir()
    : environment.HOME || homedir();
  const home = normalizedDirectory(homeValue, pathApi);
  const workspace = workspaceDirectory || environment.GITHUB_WORKSPACE;
  const remaps = [
    workspace && [workspace, '/workspace'],
    [environment.CARGO_HOME || pathApi.join(home, '.cargo'), '/cargo'],
    [environment.RUSTUP_HOME || pathApi.join(home, '.rustup'), '/rustup'],
    [home, '/home']
  ].filter(Boolean).map(([from, to]) => [normalizedDirectory(from, pathApi), to]);
  const seen = new Set();
  const uniqueRemaps = remaps
    .sort((left, right) => left[0].length - right[0].length)
    .filter(([from]) => {
      if (seen.has(from)) return false;
      seen.add(from);
      return true;
    });

  const flags = splitRustFlags(environment);
  if (platform === 'win32') flags.push('-C', 'target-feature=+crt-static');
  for (const [from, to] of uniqueRemaps) {
    flags.push('--remap-path-prefix=' + from + '=' + to);
  }

  const result = {
    ...environment,
    CARGO_ENCODED_RUSTFLAGS: flags.join('\x1f')
  };
  if (platform === 'win32') {
    const legacyFlags = (environment.RUSTFLAGS ?? '').trim().split(/\s+/).filter(Boolean);
    legacyFlags.push('-C', 'target-feature=+crt-static');
    result.RUSTFLAGS = legacyFlags.join(' ');
  }
  return result;
}

export function writeCompilerBuildEnvironment() {
  const environmentFile = process.env.GITHUB_ENV;
  if (!environmentFile) throw new Error('GITHUB_ENV must be set to configure compiler build flags.');
  const environment = compilerBuildEnvironment(process.env, process.platform);
  appendFileSync(environmentFile, 'CARGO_ENCODED_RUSTFLAGS=' + environment.CARGO_ENCODED_RUSTFLAGS + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeCompilerBuildEnvironment();
}
