import { runTests } from '@vscode/test-electron';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildPublicCompiler } from '../scripts/publicCompiler.mjs';
import { platformTarget } from '../scripts/packageCore.mjs';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--vsix');
let server = process.env.CK_VSCODE_TEST_CKC;
let publicCompiler;
if (!packaged && !server) {
  publicCompiler = buildPublicCompiler();
  server = publicCompiler.binary;
  process.on('exit', publicCompiler.cleanup);
}
if (!packaged && (!isAbsolute(server) || !existsSync(server))) {
  throw new Error('CK_VSCODE_TEST_CKC must point to an existing public ckc binary, or leave it unset to build the pinned public compiler.');
}
const profile = mkdtempSync(resolve(tmpdir(), 'ckv-'));
const workspaceFolder = resolve(profile, 'workspace');
mkdirSync(workspaceFolder);

try {
  let extensionDevelopmentPath = extensionRoot;
  if (packaged) {
    const packageJson = JSON.parse(await readFile(resolve(extensionRoot, 'package.json'), 'utf8'));
    const target = platformTarget(process.platform, process.arch);
    const vsix = resolve(extensionRoot, 'out', `${packageJson.name}-${packageJson.version}-${target}.vsix`);
    const extracted = resolve(profile, 'extracted');
    const unzip = spawnSync('unzip', ['-q', vsix, '-d', extracted], { encoding: 'utf8' });
    if (unzip.error || unzip.status !== 0) {
      throw new Error('Cannot extract VSIX: ' + String(unzip.error ?? unzip.stderr));
    }
    extensionDevelopmentPath = resolve(extracted, 'extension');
  }
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath: resolve(extensionRoot, 'test/integration/index.cjs'),
    vscodeVersion: process.env.CK_VSCODE_TEST_VERSION ?? 'stable',
    launchArgs: [
      workspaceFolder,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--user-data-dir=' + profile,
      '--extensions-dir=' + resolve(profile, 'extensions')
    ],
    extensionTestsEnv: {
      CK_VSCODE_TEST_CKC: packaged ? '' : server,
      CK_VSCODE_TEST_WORKSPACE: workspaceFolder
    }
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(profile, { recursive: true, force: true });
}
