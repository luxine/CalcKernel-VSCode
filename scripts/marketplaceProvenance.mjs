import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deriveMarketplacePrereleaseVersion, marketplacePrereleaseVsixName } from './packageCore.mjs';

const targets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'];
const extensionName = 'calckernel-vscode-plugin';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assetRecords(directory, names) {
  const root = resolve(directory);
  const present = new Set(readdirSync(root));
  const expected = new Set(names);
  const unexpected = [...present].filter((name) => !expected.has(name));
  const missing = names.filter((name) => !present.has(name));
  if (missing.length || unexpected.length) {
    throw new Error('Asset directory mismatch; missing: [' + missing.join(', ') + '], unexpected: [' + unexpected.join(', ') + '].');
  }
  return names.map((name) => {
    const path = resolve(root, name);
    if (!statSync(path).isFile()) throw new Error('Release asset is not a file: ' + name + '.');
    return { name, sizeBytes: statSync(path).size, sha256: sha256(path) };
  });
}

export function createMarketplaceProvenance({
  sourceTag,
  sourceSha,
  sourceVersion,
  marketplaceVersion,
  workflowCommit,
  workflowRunUrl,
  compilerRepository,
  compilerSha,
  compilerVersion,
  variantDirectory,
  originalDirectory
}) {
  const derivedVersion = deriveMarketplacePrereleaseVersion(sourceTag, sourceVersion);
  if (derivedVersion !== marketplaceVersion) throw new Error('Marketplace version must be the numeric base of the source tag.');
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error('Source tag commit must be a full commit SHA.');
  if (!/^[0-9a-f]{40}$/.test(workflowCommit)) throw new Error('Workflow commit must be a full commit SHA.');
  if (compilerRepository !== 'https://github.com/luxine/CalcKernel' || !/^[0-9a-f]{40}$/.test(compilerSha)) {
    throw new Error('Compiler provenance must identify an immutable public compiler commit.');
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(compilerVersion)) throw new Error('Compiler version is invalid.');
  if (typeof workflowRunUrl !== 'string' || !/^https:\/\/github\.com\/luxine\/CalcKernel-VSCode\/actions\/runs\/\d+$/.test(workflowRunUrl)) {
    throw new Error('Workflow run URL must point to this public repository.');
  }

  const variantNames = targets.map((target) => marketplacePrereleaseVsixName(extensionName, marketplaceVersion, target));
  const originalNames = targets.map((target) => extensionName + '-' + sourceVersion + '-' + target + '.vsix');
  return {
    schemaVersion: 1,
    source: {
      repository: 'https://github.com/luxine/CalcKernel-VSCode',
      tag: sourceTag,
      version: sourceVersion,
      commit: sourceSha
    },
    workflow: {
      repository: 'https://github.com/luxine/CalcKernel-VSCode',
      commit: workflowCommit,
      runUrl: workflowRunUrl
    },
    marketplace: {
      extension: 'Luxine.calckernel-vscode-plugin',
      version: marketplaceVersion,
      derivedFrom: sourceVersion,
      preRelease: true,
      versionRule: 'numeric MAJOR.MINOR.PATCH derived from the source pre-release tag; no stable release is created'
    },
    compiler: {
      repository: compilerRepository,
      commit: compilerSha,
      version: compilerVersion
    },
    originalReleaseAssets: assetRecords(originalDirectory, originalNames),
    marketplaceVariantAssets: assetRecords(variantDirectory, variantNames)
  };
}

export function verifyOriginalAssetRecords(expectedRecords, directory) {
  if (!Array.isArray(expectedRecords) || expectedRecords.length !== targets.length) {
    throw new Error('Provenance must contain exactly six original release asset records.');
  }
  const actualByName = new Map(assetRecords(directory, expectedRecords.map((record) => record.name)).map((record) => [record.name, record]));
  for (const record of expectedRecords) {
    const actual = actualByName.get(record.name);
    if (actual.sha256 !== record.sha256 || actual.sizeBytes !== record.sizeBytes) {
      throw new Error('An original GitHub Release asset changed during upload: ' + record.name + '.');
    }
  }
  return true;
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--')) throw new Error('Unexpected argument: ' + key);
    const name = key.slice(2);
    if (options[name] !== undefined) throw new Error('Pass --' + name + ' only once.');
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('--' + name + ' requires a value.');
    options[name] = value;
    index += 1;
  }
  return options;
}

function required(options, name) {
  if (!options[name]) throw new Error('Missing --' + name + '.');
  return options[name];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  const options = parseOptions(args);
  if (command === 'create') {
    const sourceTag = required(options, 'source-tag');
    const sourceVersion = required(options, 'source-version');
    const marketplaceVersion = required(options, 'marketplace-version');
    const document = createMarketplaceProvenance({
      sourceTag,
      sourceVersion,
      marketplaceVersion,
      sourceSha: required(options, 'source-sha'),
      workflowCommit: required(options, 'workflow-commit'),
      workflowRunUrl: required(options, 'workflow-run-url'),
      compilerRepository: required(options, 'compiler-repository'),
      compilerSha: required(options, 'compiler-sha'),
      compilerVersion: required(options, 'compiler-version'),
      variantDirectory: required(options, 'variant-directory'),
      originalDirectory: required(options, 'original-directory')
    });
    const output = resolve(required(options, 'output'));
    const contents = JSON.stringify(document, null, 2) + '\n';
    writeFileSync(output, contents);
    writeFileSync(output + '.sha256', createHash('sha256').update(contents).digest('hex') + '  ' + basename(output) + '\n');
    process.stdout.write(output + '\n');
  } else if (command === 'verify-originals') {
    const provenance = JSON.parse(readFileSync(resolve(required(options, 'provenance')), 'utf8'));
    verifyOriginalAssetRecords(provenance.originalReleaseAssets, required(options, 'directory'));
    process.stdout.write('Original release assets match their pre-upload SHA-256 records.\n');
  } else {
    throw new Error('Usage: marketplaceProvenance.mjs <create|verify-originals> [options].');
  }
}
