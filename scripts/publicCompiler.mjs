import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export function parseLockedCompilerRevision(value) {
  const revision = value.trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error('compiler.lock.json must contain a 40-character commit SHA from the public CalcKernel repository.');
  }
  return revision;
}

export function parseCompilerLock(value) {
  let lock;
  try {
    lock = JSON.parse(value);
  } catch (error) {
    throw new Error('compiler.lock.json must be valid JSON: ' + String(error));
  }
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    throw new Error('compiler.lock.json must contain a repository, commit, and compiler version.');
  }
  if (lock.repository !== 'https://github.com/luxine/CalcKernel') {
    throw new Error('compiler.lock.json must reference the public CalcKernel repository.');
  }
  parseLockedCompilerRevision(lock.commit);
  if (typeof lock.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(lock.version)) {
    throw new Error('compiler.lock.json must contain a valid public compiler version.');
  }
  return lock;
}

export function compilerBuildEnvironment(environment, platform) {
  if (platform !== 'win32') return environment;
  return {
    ...environment,
    RUSTFLAGS: [environment.RUSTFLAGS, '-C target-feature=+crt-static'].filter(Boolean).join(' ')
  };
}

export function buildPublicCompiler(lockedCompiler) {
  const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const lock = lockedCompiler ?? parseCompilerLock(readFileSync(resolve(extensionRoot, 'compiler.lock.json'), 'utf8'));
  const revision = lock.commit;
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'calckernel-vscode-compiler-'));
  const checkout = resolve(temporaryRoot, 'CalcKernel');
  const run = (command, args, cwd, env = process.env) => {
    const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      throw new Error('Could not build the pinned public CalcKernel compiler: ' + String(result.error ?? result.status));
    }
  };

  try {
    run('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', lock.repository, checkout]);
    run('git', ['checkout', '--quiet', '--detach', revision], checkout);
    run('cargo', ['build', '--release', '--locked', '--bin', 'ckc'], checkout, compilerBuildEnvironment(process.env, process.platform));
    const binary = resolve(checkout, 'target', 'release', process.platform === 'win32' ? 'ckc.exe' : 'ckc');
    if (!existsSync(binary)) throw new Error('The pinned public CalcKernel build did not produce ckc.');
    return {
      binary,
      cleanup: () => rmSync(temporaryRoot, { recursive: true, force: true })
    };
  } catch (error) {
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
