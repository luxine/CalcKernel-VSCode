import { isAbsolute } from 'node:path';

const triples = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc'
};

export function platformTarget(platform, arch) {
  const target = platform + '-' + arch;
  if (!(target in triples)) throw new Error('Unsupported VS Code platform: ' + target);
  return target;
}

export function compilerBinaryFromArgs(args, env = process.env) {
  let argument;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--ckc-binary') {
      if (argument !== undefined) throw new Error('Pass --ckc-binary only once.');
      argument = args[index + 1];
      if (!argument || argument.startsWith('--')) throw new Error('--ckc-binary requires a path.');
      index += 1;
    } else if (value.startsWith('--ckc-binary=')) {
      if (argument !== undefined) throw new Error('Pass --ckc-binary only once.');
      argument = value.slice('--ckc-binary='.length);
      if (!argument) throw new Error('--ckc-binary requires a path.');
    }
  }

  const binary = argument ?? env.CK_VSCODE_CKC_BINARY;
  if (!binary) return undefined;
  if (!isAbsolute(binary)) throw new Error('The CK compiler binary path must be absolute.');
  return binary;
}

export function vscePackageArgs(version, target, out) {
  const args = ['package', '--no-dependencies', '--target', target, '--out', out];
  if (version.split('+', 1)[0].includes('-')) args.push('--pre-release');
  return args;
}

export function validateBinaryIdentity(output, version, target) {
  const lines = output.split(/\r?\n/);
  if (lines[0] !== 'ckc ' + version) return 'CK server binary version does not match extension ' + version + '.';
  const triple = triples[target];
  if (!triple || !lines.includes('Target: ' + triple)) return 'CK server binary target does not match VS Code package ' + target + '.';
  if (!lines.some((line) => line.startsWith('LLVM: unavailable'))) {
    return 'CK server package must use a frontend-only binary without the Native toolchain.';
  }
  return undefined;
}

export function licenseTextMatches(checkedIn, installed) {
  const normalizeLineEndings = (text) => text.toString('utf8').replace(/\r\n/g, '\n');
  return normalizeLineEndings(checkedIn) === normalizeLineEndings(installed);
}

export function requiredVsixFiles(binaryName, notices) {
  const licenses = Array.from(
    notices.matchAll(/\((third_party\/licenses\/[^)]+)\)/g),
    (match) => match[1]
  );
  return [
    'bin/' + binaryName,
    'dist/extension.cjs',
    'package.json',
    'compiler.lock.json',
    'README.md',
    'README.zh-CN.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'language-configuration.json',
    'syntaxes/calckernel.tmLanguage.json',
    'snippets/calckernel.json',
    ...licenses
  ];
}

export function validateNotices(notices, licenses) {
  const declared = new Map();
  for (const match of notices.matchAll(/^\| ([^|]+) \| ([^|]+) \| ([^|]+) \| \[license\]\(third_party\/licenses\/([^)]+)\) \|$/gm)) {
    const [, name, version, license, filename] = match;
    const key = name.trim() + '@' + version.trim();
    if (filename !== name.trim() + '-' + version.trim() + '.txt') {
      return 'Third-party license filename does not match ' + key + '.';
    }
    if (declared.has(key)) return 'Duplicate third-party notice for ' + key + '.';
    declared.set(key, license.trim());
  }

  const actual = new Map();
  for (const [license, packages] of Object.entries(licenses)) {
    for (const pkg of packages) {
      for (const version of pkg.versions) {
        actual.set(pkg.name + '@' + version, license);
      }
    }
  }
  for (const [key, license] of actual) {
    if (!declared.has(key)) return 'Missing third-party notice for ' + key + '.';
    if (declared.get(key) !== license) return 'Third-party license mismatch for ' + key + '.';
  }
  for (const key of declared.keys()) {
    if (!actual.has(key)) return 'Stale third-party notice for ' + key + '.';
  }
  return undefined;
}

export function validateBundledPackages(metafile, licenses, builtinModules = []) {
  const licensed = new Set();
  for (const packages of Object.values(licenses)) {
    for (const pkg of packages) {
      for (const version of pkg.versions) licensed.add(pkg.name + '@' + version);
    }
  }
  for (const input of Object.keys(metafile.inputs ?? {})) {
    const normalized = input.replaceAll('\\', '/');
    const match = normalized.match(/(?:^|\/)node_modules\/\.pnpm\/([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (!match) {
      if (normalized.includes('node_modules/')) return 'Cannot identify bundled dependency from ' + input + '.';
      continue;
    }
    const [, storeDirectory, name] = match;
    const encodedName = name.replace('/', '+');
    if (!storeDirectory.startsWith(encodedName + '@')) {
      return 'Cannot identify bundled dependency version from ' + input + '.';
    }
    const version = storeDirectory.slice(encodedName.length + 1).split(/[_()]/)[0];
    const key = name + '@' + version;
    if (!licensed.has(key)) return 'Bundled dependency has no production license notice: ' + key + '.';
  }
  const allowedExternal = new Set(['vscode']);
  for (const name of builtinModules) {
    allowedExternal.add(name);
    allowedExternal.add(name.startsWith('node:') ? name : 'node:' + name);
  }
  const output = metafile.outputs?.['dist/extension.cjs'];
  if (!output) return 'Cannot inspect VSIX extension bundle output.';
  for (const imported of output.imports ?? []) {
    if (imported.external && !allowedExternal.has(imported.path)) {
      return 'Unsupported external dependency in VSIX bundle: ' + imported.path + '.';
    }
  }
  return undefined;
}
