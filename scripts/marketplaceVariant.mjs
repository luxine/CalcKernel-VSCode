import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseCompilerLock } from './publicCompiler.mjs';
import { deriveMarketplacePrereleaseVersion, marketplacePrereleasePackageArgs, validateMarketplaceVariantMetadata } from './packageCore.mjs';

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) throw new Error('Unexpected argument: ' + value);
    const key = value.slice(2);
    if (options[key] !== undefined) throw new Error('Pass --' + key + ' only once.');
    const argument = args[index + 1];
    if (!argument || argument.startsWith('--')) throw new Error('--' + key + ' requires a value.');
    options[key] = argument;
    index += 1;
  }
  return options;
}

function requireOption(options, name) {
  const value = options[name];
  if (!value) throw new Error('Missing --' + name + '.');
  return value;
}

function requireSha(value, name) {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(name + ' must be a full 40-character commit SHA.');
  return value;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error('Cannot read ' + label + ': ' + String(error));
  }
}

function derive(options) {
  const sourceRoot = resolve(requireOption(options, 'source-dir'));
  const tag = requireOption(options, 'tag');
  const sourceSha = requireSha(requireOption(options, 'source-sha'), 'Source tag SHA');
  const packageJson = readJson(resolve(sourceRoot, 'package.json'), 'source package.json');
  const compilerLock = parseCompilerLock(readFileSync(resolve(sourceRoot, 'compiler.lock.json'), 'utf8'));
  const marketplaceVersion = deriveMarketplacePrereleaseVersion(tag, packageJson.version);
  if (packageJson.name !== 'calckernel-vscode-plugin' || packageJson.publisher !== 'Luxine') {
    throw new Error('Source tag does not contain the published CalcKernel extension identity.');
  }
  if (packageJson.repository?.url !== 'https://github.com/luxine/CalcKernel-VSCode.git' ||
      packageJson.bugs?.url !== 'https://github.com/luxine/CalcKernel-VSCode/issues') {
    throw new Error('Source tag metadata must reference the public VS Code repository.');
  }

  const output = options.output;
  if (output) {
    appendFileSync(output, [
      ['source_tag', tag],
      ['source_sha', sourceSha],
      ['source_version', packageJson.version],
      ['marketplace_version', marketplaceVersion],
      ['compiler_repository', compilerLock.repository],
      ['compiler_sha', compilerLock.commit],
      ['compiler_version', compilerLock.version]
    ].map(([key, value]) => key + '=' + value + '\n').join(''));
  }
  process.stdout.write(JSON.stringify({
    sourceTag: tag,
    sourceSha,
    sourceVersion: packageJson.version,
    marketplaceVersion,
    compilerRepository: compilerLock.repository,
    compilerSha: compilerLock.commit,
    compilerVersion: compilerLock.version
  }) + '\n');
}

function packageVariant(options) {
  const sourceRoot = resolve(requireOption(options, 'source-dir'));
  const tag = requireOption(options, 'tag');
  const target = requireOption(options, 'target');
  const compilerSha = requireSha(requireOption(options, 'compiler-sha'), 'Compiler SHA');
  const output = resolve(requireOption(options, 'output'));
  const packageJson = readJson(resolve(sourceRoot, 'package.json'), 'source package.json');
  const compilerLock = parseCompilerLock(readFileSync(resolve(sourceRoot, 'compiler.lock.json'), 'utf8'));
  deriveMarketplacePrereleaseVersion(tag, packageJson.version);
  if (compilerLock.commit !== compilerSha) throw new Error('Source compiler.lock.json does not match the validated public compiler commit.');
  if (packageJson.repository?.url !== 'https://github.com/luxine/CalcKernel-VSCode.git' ||
      packageJson.bugs?.url !== 'https://github.com/luxine/CalcKernel-VSCode/issues') {
    throw new Error('Source tag metadata must reference the public VS Code repository.');
  }
  mkdirSync(dirname(output), { recursive: true });
  const timestamp = spawnSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
    cwd: sourceRoot,
    encoding: 'utf8'
  });
  if (timestamp.error || timestamp.status !== 0 || !/^\d+$/.test(timestamp.stdout.trim())) {
    throw new Error('Cannot determine a reproducible VSIX timestamp from the source tag.');
  }
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const packaged = spawnSync(pnpm, ['exec', 'vsce', ...marketplacePrereleasePackageArgs(tag, packageJson.version, target, output)], {
    cwd: sourceRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? timestamp.stdout.trim() }
  });
  if (packaged.error || packaged.status !== 0) {
    throw new Error('Marketplace numeric pre-release VSIX packaging failed: ' + String(packaged.error ?? packaged.status));
  }
  if (!existsSync(output)) throw new Error('VSCE did not create the Marketplace variant: ' + output + '.');
  process.stdout.write(output + '\n');
}

function verify(options) {
  const archiveRoot = resolve(requireOption(options, 'directory'));
  const extensionRoot = resolve(archiveRoot, 'extension');
  const tag = requireOption(options, 'tag');
  const sourceSha = requireSha(requireOption(options, 'source-sha'), 'Source tag SHA');
  const compilerSha = requireSha(requireOption(options, 'compiler-sha'), 'Compiler SHA');
  const compilerVersion = requireOption(options, 'compiler-version');
  const target = requireOption(options, 'target');
  const packageJson = readJson(resolve(extensionRoot, 'package.json'), 'packaged extension package.json');
  const compilerLock = readJson(resolve(extensionRoot, 'compiler.lock.json'), 'packaged compiler.lock.json');
  const manifest = readFileSync(resolve(archiveRoot, 'extension.vsixmanifest'), 'utf8');
  const error = validateMarketplaceVariantMetadata({
    tag,
    sourceVersion: options['source-version'] ?? tag.slice(1),
    packageJson,
    compilerLock,
    manifest,
    expectedCompilerCommit: compilerSha,
    expectedCompilerVersion: compilerVersion,
    expectedTarget: target
  });
  if (error) throw new Error(error);
  process.stdout.write(JSON.stringify({
    sourceTag: tag,
    sourceSha,
    marketplaceVersion: packageJson.version,
    target,
    publisher: packageJson.publisher,
    extension: packageJson.name,
    repository: packageJson.repository.url,
    compilerRepository: compilerLock.repository,
    compilerSha: compilerLock.commit,
    compilerVersion: compilerLock.version
  }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (command === 'derive') derive(options);
  else if (command === 'package') packageVariant(options);
  else if (command === 'verify') verify(options);
  else throw new Error('Usage: marketplaceVariant.mjs <derive|package|verify> [options].');
}
