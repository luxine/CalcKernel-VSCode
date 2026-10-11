import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilerBuildEnvironment, parseCompilerLock, parseLockedCompilerRevision } from '../scripts/publicCompiler.mjs';
import { createMarketplaceProvenance, verifyOriginalAssetRecords } from '../scripts/marketplaceProvenance.mjs';
import { compilerBinaryFromArgs, deriveMarketplacePrereleaseVersion, licenseTextMatches, marketplacePrereleasePackageArgs, marketplacePrereleaseVsixName, platformTarget, requiredVsixFiles, validateBinaryIdentity, validateBundledPackages, validateMarketplaceVariantMetadata, validateNoCompilerCheckoutInVsix, validateNotices, vscePackageArgs } from '../scripts/packageCore.mjs';

test('license comparison accepts checkout line endings but rejects changed text', () => {
  assert.equal(licenseTextMatches(Buffer.from('Line one\nLine two\n'), Buffer.from('Line one\r\nLine two\r\n')), true);
  assert.equal(licenseTextMatches(Buffer.from('Line one\nLine two\n'), Buffer.from('Line one\nLine three\n')), false);
  assert.equal(licenseTextMatches(Buffer.from([0xff, 0x0a]), Buffer.from([0xfe, 0x0a])), false);
});

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

test('Marketplace numeric version is derived only from a matching pre-release tag', () => {
  assert.equal(deriveMarketplacePrereleaseVersion('v0.15.0-dev.2', '0.15.0-dev.2'), '0.15.0');
  assert.equal(deriveMarketplacePrereleaseVersion('v1.2.3-alpha.1', '1.2.3-alpha.1'), '1.2.3');
  assert.throws(() => deriveMarketplacePrereleaseVersion('v0.15.0', '0.15.0'), /pre-release tag/);
  assert.throws(() => deriveMarketplacePrereleaseVersion('v0.16.0-dev.2', '0.15.0-dev.2'), /does not match/);
  assert.throws(() => deriveMarketplacePrereleaseVersion('v0.15.0-dev.2', '0.15.0-dev.3'), /does not match/);
  assert.throws(() => deriveMarketplacePrereleaseVersion('v0.15.0-dev.02', '0.15.0-dev.02'), /valid pre-release/);
});

test('Marketplace variant packaging explicitly keeps the numeric version marked pre-release', () => {
  assert.deepEqual(marketplacePrereleasePackageArgs('v0.15.0-dev.2', '0.15.0-dev.2', 'linux-x64', 'out/marketplace.vsix'), [
    'package', '--no-dependencies', '--target', 'linux-x64', '--out', 'out/marketplace.vsix',
    '--pre-release', '--no-update-package-json', '--no-git-tag-version', '0.15.0'
  ]);
  assert.equal(marketplacePrereleaseVsixName('calckernel-vscode-plugin', '0.15.0', 'linux-x64'), 'calckernel-vscode-plugin-0.15.0-marketplace-prerelease-linux-x64.vsix');
  assert.throws(() => marketplacePrereleasePackageArgs('v0.15.0-dev.2', '0.16.0-dev.2', 'linux-x64', 'out/a.vsix'), /does not match/);
});

test('numeric Marketplace VSIX metadata verifies package identity, target, prerelease and compiler provenance', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  const packageJson = {
    name: 'calckernel-vscode-plugin',
    publisher: 'Luxine',
    version: '0.15.0',
    repository: { url: 'https://github.com/luxine/CalcKernel-VSCode.git' },
    bugs: { url: 'https://github.com/luxine/CalcKernel-VSCode/issues' }
  };
  const compilerLock = { repository: 'https://github.com/luxine/CalcKernel', commit, version: '0.15.0-dev.0' };
  const manifest = '<PackageManifest><Metadata><Identity Id="calckernel-vscode-plugin" Publisher="Luxine" Version="0.15.0" TargetPlatform="linux-x64"/><Properties><Property Id="Microsoft.VisualStudio.Code.TargetPlatform" Value="linux-x64"/><Property Id="Microsoft.VisualStudio.Code.PreRelease" Value="true"/><Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="https://github.com/luxine/CalcKernel-VSCode.git"/><Property Id="Microsoft.VisualStudio.Services.Links.GitHub" Value="https://github.com/luxine/CalcKernel-VSCode.git"/><Property Id="Microsoft.VisualStudio.Services.Links.Support" Value="https://github.com/luxine/CalcKernel-VSCode/issues"/></Properties></Metadata></PackageManifest>';
  const valid = {
    tag: 'v0.15.0-dev.2', sourceVersion: '0.15.0-dev.2', packageJson, compilerLock, manifest,
    expectedCompilerCommit: commit, expectedCompilerVersion: '0.15.0-dev.0', expectedTarget: 'linux-x64'
  };
  assert.equal(validateMarketplaceVariantMetadata(valid), undefined);
  assert.match(validateMarketplaceVariantMetadata({ ...valid, expectedCompilerCommit: 'abcdef0123456789abcdef0123456789abcdef01' }), /compiler commit/);
  assert.match(validateMarketplaceVariantMetadata({ ...valid, expectedCompilerVersion: '0.16.0-dev.0' }), /compiler version/);
  assert.match(validateMarketplaceVariantMetadata({ ...valid, expectedTarget: 'darwin-arm64' }), /target/);
  assert.match(validateMarketplaceVariantMetadata({ ...valid, manifest: manifest.replace('Value="true"', 'Value="false"') }), /pre-release/);
  assert.match(validateMarketplaceVariantMetadata({ ...valid, manifest: manifest.replace('Links.GitHub" Value="https://github.com/luxine/CalcKernel-VSCode.git', 'Links.GitHub" Value="https://example.com') }), /source links/);
  assert.match(validateMarketplaceVariantMetadata({ ...valid, packageJson: { ...packageJson, bugs: { url: 'https://example.com/issues' } } }), /issue tracker/);
});

test('Marketplace provenance records both commits and hashes all six variants and original assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'ck-marketplace-provenance-'));
  const variants = join(root, 'variants');
  const originals = join(root, 'originals');
  mkdirSync(variants);
  mkdirSync(originals);
  const targets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'];
  for (const target of targets) {
    writeFileSync(join(variants, marketplacePrereleaseVsixName('calckernel-vscode-plugin', '0.15.0', target)), 'variant-' + target);
    writeFileSync(join(originals, 'calckernel-vscode-plugin-0.15.0-dev.2-' + target + '.vsix'), 'original-' + target);
  }
  try {
    const provenance = createMarketplaceProvenance({
      sourceTag: 'v0.15.0-dev.2', sourceSha: '1'.repeat(40), sourceVersion: '0.15.0-dev.2', marketplaceVersion: '0.15.0',
      workflowCommit: '2'.repeat(40), workflowRunUrl: 'https://github.com/luxine/CalcKernel-VSCode/actions/runs/123456',
      compilerRepository: 'https://github.com/luxine/CalcKernel', compilerSha: '3'.repeat(40), compilerVersion: '0.15.0-dev.0',
      variantDirectory: variants, originalDirectory: originals
    });
    assert.equal(provenance.source.commit, '1'.repeat(40));
    assert.equal(provenance.workflow.commit, '2'.repeat(40));
    assert.equal(provenance.compiler.commit, '3'.repeat(40));
    assert.equal(provenance.marketplace.preRelease, true);
    assert.equal(provenance.marketplaceVariantAssets.length, 6);
    assert.ok(provenance.marketplaceVariantAssets.every((asset) => /^[0-9a-f]{64}$/.test(asset.sha256)));
    assert.equal(verifyOriginalAssetRecords(provenance.originalReleaseAssets, originals), true);
    writeFileSync(join(originals, 'calckernel-vscode-plugin-0.15.0-dev.2-darwin-arm64.vsix'), 'replaced');
    assert.throws(() => verifyOriginalAssetRecords(provenance.originalReleaseAssets, originals), /changed during upload/);
    assert.throws(() => createMarketplaceProvenance({
      sourceTag: 'v0.15.0-dev.2', sourceSha: '1'.repeat(40), sourceVersion: '0.15.0-dev.2', marketplaceVersion: '0.16.0',
      workflowCommit: '2'.repeat(40), workflowRunUrl: 'https://github.com/luxine/CalcKernel-VSCode/actions/runs/123456',
      compilerRepository: 'https://github.com/luxine/CalcKernel', compilerSha: '3'.repeat(40), compilerVersion: '0.15.0-dev.0',
      variantDirectory: variants, originalDirectory: originals
    }), /numeric base/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('compiler builds remap workspace, Cargo, Rustup, and home paths into fixed prefixes', () => {
  const environment = compilerBuildEnvironment({
    GITHUB_WORKSPACE: '/home/worker/project',
    HOME: '/home/worker',
    CARGO_HOME: '/home/worker/.cargo',
    RUSTUP_HOME: '/home/worker/.rustup',
    RUSTFLAGS: '--cfg ck_release'
  }, 'linux');
  const flags = environment.CARGO_ENCODED_RUSTFLAGS.split('\x1f');

  assert.deepEqual(flags.slice(0, 2), ['--cfg', 'ck_release']);
  assert.ok(flags.includes('--remap-path-prefix=/home/worker/project=/workspace'));
  assert.ok(flags.includes('--remap-path-prefix=/home/worker/.cargo=/cargo'));
  assert.ok(flags.includes('--remap-path-prefix=/home/worker/.rustup=/rustup'));
  assert.ok(flags.includes('--remap-path-prefix=/home/worker=/home'));
});

test('compiler build path remaps preserve Windows static CRT flags and paths containing spaces', () => {
  const environment = compilerBuildEnvironment({
    GITHUB_WORKSPACE: 'C:\\Users\\runner admin\\_work\\project',
    HOME: 'C:\\Users\\runner admin',
    CARGO_HOME: 'C:\\Users\\runner admin\\.cargo',
    RUSTUP_HOME: 'D:\\toolchain cache\\rustup',
    RUSTFLAGS: '--cfg ck_release'
  }, 'win32');
  const flags = environment.CARGO_ENCODED_RUSTFLAGS.split('\x1f');

  assert.ok(flags.includes('--cfg'));
  assert.ok(flags.includes('ck_release'));
  assert.ok(flags.includes('-C'));
  assert.ok(flags.includes('target-feature=+crt-static'));
  assert.ok(flags.includes('--remap-path-prefix=C:\\Users\\runner admin\\_work\\project=/workspace'));
  assert.ok(flags.includes('--remap-path-prefix=C:\\Users\\runner admin\\.cargo=/cargo'));
  assert.ok(flags.includes('--remap-path-prefix=D:\\toolchain cache\\rustup=/rustup'));
  assert.ok(flags.includes('--remap-path-prefix=C:\\Users\\runner admin=/home'));
});

test('Windows builds force static CRT after conflicting encoded target-feature flags', () => {
  const inputs = [
    '--cfg\x1fkeep_this\x1f-C\x1ftarget-feature=+crt-static\x1f-C\x1ftarget-feature=-crt-static',
    '-C\x1ftarget-feature=+crt-static\x1f-C\x1ftarget-feature=-crt-static,+sse2',
    '-C\x1ftarget-feature=+crt-static,-crt-static'
  ];

  for (const encodedFlags of inputs) {
    const flags = compilerBuildEnvironment({ CARGO_ENCODED_RUSTFLAGS: encodedFlags }, 'win32')
      .CARGO_ENCODED_RUSTFLAGS.split('\x1f');
    const targetFeatureOptions = flags.filter((flag, index) =>
      flags[index - 1] === '-C' && flag.startsWith('target-feature=')
    );

    assert.equal(targetFeatureOptions.at(-1), 'target-feature=+crt-static');
  }

  const encoded = compilerBuildEnvironment({ CARGO_ENCODED_RUSTFLAGS: inputs[0] }, 'win32')
    .CARGO_ENCODED_RUSTFLAGS.split('\x1f');
  assert.ok(encoded.includes('--cfg'));
  assert.ok(encoded.includes('keep_this'));
});

test('Windows legacy RUSTFLAGS also end with static CRT after a conflicting override', () => {
  const inheritedFlags = '-C target-feature=+crt-static -C target-feature=-crt-static';
  const environment = compilerBuildEnvironment({ RUSTFLAGS: inheritedFlags }, 'win32');

  assert.equal(environment.RUSTFLAGS, inheritedFlags + ' -C target-feature=+crt-static');
});

test('an explicitly empty encoded Cargo flag list overrides legacy RUSTFLAGS', () => {
  const environment = compilerBuildEnvironment({
    HOME: '/home/worker',
    RUSTFLAGS: '--cfg legacy_flag',
    CARGO_ENCODED_RUSTFLAGS: ''
  }, 'linux');
  const flags = environment.CARGO_ENCODED_RUSTFLAGS.split('\x1f');

  assert.equal(flags.includes('legacy_flag'), false);
  assert.equal(flags.includes('--cfg'), false);
});

test('nonempty encoded Cargo flags take precedence over legacy RUSTFLAGS', () => {
  const environment = compilerBuildEnvironment({
    HOME: '/home/worker',
    RUSTFLAGS: '--cfg legacy_flag',
    CARGO_ENCODED_RUSTFLAGS: '--cfg\x1fencoded_flag'
  }, 'linux');
  const flags = environment.CARGO_ENCODED_RUSTFLAGS.split('\x1f');

  assert.deepEqual(flags.slice(0, 2), ['--cfg', 'encoded_flag']);
  assert.equal(flags.includes('legacy_flag'), false);
});

test('rustc maps an absolute source nested under Cargo home with the specific prefix', () => {
  const pathApi = process.platform === 'win32' ? win32 : posix;
  const root = mkdtempSync(join(tmpdir(), 'ck-rust-remap-'));
  const workspace = pathApi.join(root, 'workspace');
  const home = pathApi.join(root, 'worker home');
  const cargoHome = pathApi.join(home, '.cargo');
  const rustupHome = process.env.RUSTUP_HOME || pathApi.join(homedir(), '.rustup');
  const nestedSource = pathApi.join(cargoHome, 'registry', 'source.rs');
  const mainSource = pathApi.join(workspace, 'main.rs');
  const executable = pathApi.join(root, process.platform === 'win32' ? 'probe.exe' : 'probe');

  try {
    mkdirSync(pathApi.dirname(nestedSource), { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(nestedSource, 'pub fn source_path() -> &\'static str { file!() }\n');
    writeFileSync(mainSource, '#[path = ' + JSON.stringify(nestedSource) + ']\nmod registry_source;\nfn main() { print!("{}", registry_source::source_path()); }\n');

    const environment = compilerBuildEnvironment({
      ...process.env,
      GITHUB_WORKSPACE: workspace,
      HOME: home,
      USERPROFILE: home,
      CARGO_HOME: cargoHome,
      RUSTUP_HOME: rustupHome,
      RUSTFLAGS: '',
      CARGO_ENCODED_RUSTFLAGS: ''
    }, process.platform, workspace);
    const flags = environment.CARGO_ENCODED_RUSTFLAGS.split('\x1f');
    const compiled = spawnSync('rustc', [mainSource, '--edition=2021', '-o', executable, ...flags], {
      encoding: 'utf8',
      env: environment
    });
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));

    const output = spawnSync(executable, [], { encoding: 'utf8' });
    assert.equal(output.status, 0, output.stderr || String(output.error));
    assert.equal(output.stdout.replaceAll('\\', '/'), '/cargo/registry/source.rs');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compiler build environment script writes the encoded flags consumed by Cargo', () => {
  const root = mkdtempSync(join(tmpdir(), 'ck-compiler-env-'));
  const environmentFile = join(root, 'github-env');
  const windows = process.platform === 'win32';
  const home = windows ? 'C:\\agent user' : '/agent user';
  const workspace = windows ? 'D:\\agent work\\project' : '/agent work/project';
  const cargoHome = windows ? home + '\\.cargo' : home + '/.cargo';
  const rustupHome = windows ? home + '\\.rustup' : home + '/.rustup';
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '../scripts/compilerBuildEnvironment.mjs');

  try {
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_ENV: environmentFile,
        GITHUB_WORKSPACE: workspace,
        HOME: home,
        USERPROFILE: home,
        CARGO_HOME: cargoHome,
        RUSTUP_HOME: rustupHome,
        RUSTFLAGS: '',
        CARGO_ENCODED_RUSTFLAGS: ''
      }
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const line = readFileSync(environmentFile, 'utf8').trimEnd();
    assert.ok(line.startsWith('CARGO_ENCODED_RUSTFLAGS='));
    const flags = line.slice('CARGO_ENCODED_RUSTFLAGS='.length).split('\x1f');
    const pathApi = windows ? win32 : posix;
    const expectedWorkspace = pathApi.resolve(workspace);
    const expectedCargo = pathApi.resolve(cargoHome);
    const expectedRustup = pathApi.resolve(rustupHome);
    const expectedHome = pathApi.resolve(home);
    assert.ok(flags.includes('--remap-path-prefix=' + expectedWorkspace + '=/workspace'));
    assert.ok(flags.includes('--remap-path-prefix=' + expectedCargo + '=/cargo'));
    assert.ok(flags.includes('--remap-path-prefix=' + expectedRustup + '=/rustup'));
    assert.ok(flags.includes('--remap-path-prefix=' + expectedHome + '=/home'));
    if (windows) {
      assert.ok(flags.includes('-C'));
      assert.ok(flags.includes('target-feature=+crt-static'));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('package rejects compiler checkout files from the VSIX member list', () => {
  assert.equal(validateNoCompilerCheckoutInVsix(['package.json', 'dist/extension.cjs']), undefined);
  assert.match(validateNoCompilerCheckoutInVsix(['CalcKernel/src/lib.rs']), /compiler checkout/);
  assert.match(validateNoCompilerCheckoutInVsix(['.\\CalcKernel\\target\\release\\ckc']), /compiler checkout/);
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
