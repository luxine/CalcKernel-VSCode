import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilerBuildEnvironment, parseCompilerLock, parseLockedCompilerRevision } from '../scripts/publicCompiler.mjs';
import { compilerBinaryFromArgs, platformTarget, requiredVsixFiles, validateBinaryIdentity, validateBundledPackages, validateNotices, vscePackageArgs } from '../scripts/packageCore.mjs';

test('platform targets cover the six release hosts', () => {
  assert.equal(platformTarget('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(platformTarget('darwin', 'x64'), 'darwin-x64');
  assert.equal(platformTarget('linux', 'arm64'), 'linux-arm64');
  assert.equal(platformTarget('linux', 'x64'), 'linux-x64');
  assert.equal(platformTarget('win32', 'arm64'), 'win32-arm64');
  assert.equal(platformTarget('win32', 'x64'), 'win32-x64');
});

test('package rejects wrong version, target, or Native toolchain binary', () => {
  const good = 'ckc 0.15.0-dev.0\nLLVM: unavailable (native-toolchain feature disabled)\nTarget: aarch64-apple-darwin\n';
  assert.equal(validateBinaryIdentity(good, '0.15.0-dev.0', 'darwin-arm64'), undefined);
  assert.match(validateBinaryIdentity(good.replace('0.15.0-dev.0', '0.14.0'), '0.15.0-dev.0', 'darwin-arm64'), /version/);
  assert.match(validateBinaryIdentity(good, '0.15.0-dev.0', 'linux-arm64'), /target/);
  assert.match(validateBinaryIdentity(good.replace('LLVM: unavailable', 'LLVM: 22.1.8'), '0.15.0-dev.0', 'darwin-arm64'), /Native/);
});

test('packaging accepts an explicit public compiler binary override', () => {
  assert.equal(compilerBinaryFromArgs(['--ckc-binary', resolve('/opt/ckc')], {}), resolve('/opt/ckc'));
  assert.equal(compilerBinaryFromArgs(['--ckc-binary=' + resolve('/opt/ckc')], {}), resolve('/opt/ckc'));
  assert.equal(compilerBinaryFromArgs([], { CK_VSCODE_CKC_BINARY: resolve('/opt/from-env/ckc') }), resolve('/opt/from-env/ckc'));
  assert.equal(compilerBinaryFromArgs([], {}), undefined);
  assert.throws(() => compilerBinaryFromArgs(['--ckc-binary'], {}), /requires a path/);
  assert.throws(() => compilerBinaryFromArgs(['--ckc-binary', 'relative/ckc'], {}), /must be absolute/);
  assert.throws(() => compilerBinaryFromArgs(['--ckc-binary', resolve('/opt/ckc'), '--ckc-binary', resolve('/opt/other')], {}), /only once/);
});

test('pre-release extension versions mark the VSIX as a pre-release package', () => {
  assert.deepEqual(vscePackageArgs('0.15.0-dev.0', 'darwin-arm64', 'out/extension.vsix'), [
    'package', '--no-dependencies', '--target', 'darwin-arm64', '--out', 'out/extension.vsix', '--pre-release'
  ]);
  assert.deepEqual(vscePackageArgs('1.0.0+build-info', 'linux-x64', 'out/extension.vsix'), [
    'package', '--no-dependencies', '--target', 'linux-x64', '--out', 'out/extension.vsix'
  ]);
});

test('public compiler lock requires an immutable commit SHA', () => {
  const revision = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(parseLockedCompilerRevision(revision + '\n'), revision);
  assert.throws(() => parseLockedCompilerRevision('v0.15.0-dev.0\n'), /40-character commit SHA/);
  assert.throws(() => parseLockedCompilerRevision('main\n'), /40-character commit SHA/);
  const lock = { repository: 'https://github.com/luxine/CalcKernel', commit: revision, version: '0.15.0-dev.0' };
  assert.deepEqual(parseCompilerLock(JSON.stringify(lock)), lock);
  assert.throws(() => parseCompilerLock(JSON.stringify({ ...lock, repository: 'https://example.com/other.git' })), /public CalcKernel repository/);
  assert.throws(() => parseCompilerLock(JSON.stringify({ ...lock, version: 'latest' })), /compiler version/);
});

test('public compiler Windows builds preserve flags and statically link the CRT', () => {
  const environment = compilerBuildEnvironment({ RUSTFLAGS: '--cfg ck_release' }, 'win32');
  assert.equal(environment.RUSTFLAGS, '--cfg ck_release -C target-feature=+crt-static');
  assert.equal(compilerBuildEnvironment({}, 'darwin').RUSTFLAGS, undefined);
});

test('package requires runtime resources and every listed third-party license', () => {
  const notices = readFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
  const files = requiredVsixFiles('ckc', notices);
  for (const path of [
    'bin/ckc',
    'dist/extension.cjs',
    'compiler.lock.json',
    'syntaxes/calckernel.tmLanguage.json',
    'snippets/calckernel.json',
    'language-configuration.json',
    'README.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'third_party/licenses/minimatch-10.2.6.txt',
    'third_party/licenses/vscode-languageclient-10.1.1.txt'
  ]) {
    assert.ok(files.includes(path), path + ' must be included in the VSIX');
  }
});

test('notices must exactly match the production dependency licenses', () => {
  const notices = '| Package | Version | License | Text |\n' +
    '| --- | --- | --- | --- |\n' +
    '| a | 1.0.0 | MIT | [license](third_party/licenses/a-1.0.0.txt) |\n';
  const actual = { MIT: [{ name: 'a', versions: ['1.0.0'], license: 'MIT' }] };
  assert.equal(validateNotices(notices, actual), undefined);
  assert.match(validateNotices(notices, { MIT: [...actual.MIT, { name: 'b', versions: ['2.0.0'], license: 'MIT' }] }), /b@2\.0\.0/);
  assert.match(validateNotices(notices, { ISC: [{ name: 'a', versions: ['1.0.0'], license: 'ISC' }] }), /license/);
  assert.match(validateNotices(notices, {}), /a@1\.0\.0/);
});

test('bundle inputs cannot introduce an unlicensed development dependency', () => {
  const actual = { MIT: [{ name: 'a', versions: ['1.0.0'], license: 'MIT' }] };
  const bundled = { inputs: {
    'node_modules/.pnpm/a@1.0.0/node_modules/a/index.js': {},
    'node_modules/.pnpm/dev-only@2.0.0/node_modules/dev-only/index.js': {},
    'src/extension.ts': {}
  }, outputs: { 'dist/extension.cjs': { imports: [] } } };
  assert.match(validateBundledPackages(bundled, actual), /dev-only@2\.0\.0/);
  delete bundled.inputs['node_modules/.pnpm/dev-only@2.0.0/node_modules/dev-only/index.js'];
  assert.equal(validateBundledPackages(bundled, actual), undefined);
});

test('bundle cannot leave an npm dependency external to the VSIX', () => {
  const actual = { MIT: [{ name: 'a', versions: ['1.0.0'], license: 'MIT' }] };
  const bundled = { inputs: {}, outputs: { 'dist/extension.cjs': { imports: [
    { path: 'vscode', external: true },
    { path: 'node:fs', external: true },
    { path: 'dev-only', external: true }
  ] } } };
  assert.match(validateBundledPackages(bundled, actual, builtinModules), /dev-only/);
  bundled.outputs['dist/extension.cjs'].imports.pop();
  assert.equal(validateBundledPackages(bundled, actual, builtinModules), undefined);
});

test('checked-in notices cover every installed production dependency', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(pnpm, ['licenses', 'list', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const notices = readFileSync(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const licenses = JSON.parse(result.stdout);
  assert.equal(validateNotices(notices, licenses), undefined);
  const build = spawnSync(process.execPath, ['esbuild.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr || String(build.error));
  const bundle = JSON.parse(readFileSync(resolve(root, 'dist/extension.meta.json'), 'utf8'));
  assert.equal(validateBundledPackages(bundle, licenses, builtinModules), undefined);
});
