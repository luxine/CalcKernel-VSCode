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

export function deriveMarketplacePrereleaseVersion(tag, sourceVersion) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)$/.exec(tag);
  if (!match) throw new Error('Marketplace numeric variants require a valid pre-release tag such as v0.15.0-dev.2.');
  const prereleaseIdentifiers = match[4].split('.');
  if (prereleaseIdentifiers.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    throw new Error('Marketplace numeric variants require a valid pre-release tag without leading zero identifiers.');
  }
  const taggedSourceVersion = tag.slice(1);
  if (sourceVersion !== taggedSourceVersion) {
    throw new Error('Source package version ' + sourceVersion + ' does not match tag ' + tag + '.');
  }
  return match.slice(1, 4).join('.');
}

export function marketplacePrereleasePackageArgs(tag, sourceVersion, target, out) {
  deriveMarketplacePrereleaseVersion(tag, sourceVersion);
  if (!(target in triples)) throw new Error('Unsupported VS Code platform: ' + target);
  const version = tag.slice(1).split('-', 1)[0];
  return [
    'package', '--no-dependencies', '--target', target, '--out', out,
    '--pre-release', '--no-update-package-json', '--no-git-tag-version', version
  ];
}

export function marketplacePrereleaseVsixName(packageName, version, target) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Marketplace package version must be numeric.');
  if (!(target in triples)) throw new Error('Unsupported VS Code platform: ' + target);
  return packageName + '-' + version + '-marketplace-prerelease-' + target + '.vsix';
}

function xmlAttribute(attributes, name) {
  const match = new RegExp("(?:^|\\s)" + name + "=[\"']([^\"']*)[\"']").exec(attributes);
  return match?.[1];
}

export function validateMarketplaceVariantMetadata({ tag, sourceVersion, packageJson, compilerLock, manifest, expectedCompilerCommit, expectedTarget }) {
  let version;
  try {
    version = deriveMarketplacePrereleaseVersion(tag, sourceVersion);
  } catch (error) {
    return String(error.message);
  }
  if (packageJson.name !== 'calckernel-vscode-plugin') return 'Marketplace package name does not match the published extension identity.';
  if (packageJson.publisher !== 'Luxine') return 'Marketplace publisher does not match the published extension identity.';
  if (packageJson.version !== version) return 'Marketplace package.json version must be the numeric version derived from the source tag.';
  if (packageJson.repository?.url !== 'https://github.com/luxine/CalcKernel-VSCode.git') {
    return 'Marketplace package repository must point to the public VS Code repository.';
  }
  if (packageJson.bugs?.url !== 'https://github.com/luxine/CalcKernel-VSCode/issues') {
    return 'Marketplace package issue tracker must point to the public VS Code repository.';
  }
  if (compilerLock.repository !== 'https://github.com/luxine/CalcKernel') {
    return 'Bundled compiler provenance must point to the public CalcKernel repository.';
  }
  if (!/^[0-9a-f]{40}$/.test(compilerLock.commit) || (expectedCompilerCommit && compilerLock.commit !== expectedCompilerCommit)) {
    return 'Bundled compiler provenance does not match the locked public compiler commit.';
  }
  if (typeof compilerLock.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(compilerLock.version)) {
    return 'Bundled compiler provenance has an invalid compiler version.';
  }

  const identity = /<Identity\b([^>]*)\/?\s*>/s.exec(manifest)?.[1];
  if (!identity) return 'VSIX manifest is missing its Identity element.';
  if (xmlAttribute(identity, 'Id') !== packageJson.name || xmlAttribute(identity, 'Publisher') !== packageJson.publisher) {
    return 'VSIX manifest publisher or extension identity does not match package.json.';
  }
  if (xmlAttribute(identity, 'Version') !== version) return 'VSIX manifest version must be the numeric version derived from the source tag.';
  const properties = Array.from(manifest.matchAll(/<Property\b([^>]*)\/?\s*>/g), (match) => match[1]);
  const propertyValue = (id) => {
    const property = properties.find((attributes) => xmlAttribute(attributes, 'Id') === id);
    return property && xmlAttribute(property, 'Value');
  };
  const preRelease = properties.some((attributes) =>
    xmlAttribute(attributes, 'Id') === 'Microsoft.VisualStudio.Code.PreRelease' && xmlAttribute(attributes, 'Value') === 'true'
  );
  if (!preRelease) return 'VSIX manifest must mark this numeric version as a pre-release.';
  const actualTarget = xmlAttribute(identity, 'TargetPlatform') ?? propertyValue('Microsoft.VisualStudio.Code.TargetPlatform');
  if (expectedTarget && actualTarget !== expectedTarget) {
    return 'VSIX manifest target does not match the requested platform.';
  }
  if (propertyValue('Microsoft.VisualStudio.Services.Links.Source') !== 'https://github.com/luxine/CalcKernel-VSCode.git' ||
      propertyValue('Microsoft.VisualStudio.Services.Links.GitHub') !== 'https://github.com/luxine/CalcKernel-VSCode.git') {
    return 'VSIX manifest source links must point to the public VS Code repository.';
  }
  if (propertyValue('Microsoft.VisualStudio.Services.Links.Support') !== 'https://github.com/luxine/CalcKernel-VSCode/issues') {
    return 'VSIX manifest support link must point to the public VS Code issue tracker.';
  }
  return undefined;
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
  const normalizeLineEndings = (text) => text.toString('latin1').replace(/\r\n/g, '\n');
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
