import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublicCompiler, parseCompilerLock } from './publicCompiler.mjs';
import { compilerBinaryFromArgs, platformTarget, requiredVsixFiles, validateBinaryIdentity, validateBundledPackages, validateNotices, vscePackageArgs } from './packageCore.mjs';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(extensionRoot, 'package.json'), 'utf8'));
const compilerLock = parseCompilerLock(readFileSync(resolve(extensionRoot, 'compiler.lock.json'), 'utf8'));
const target = platformTarget(process.platform, process.arch);
const binaryName = process.platform === 'win32' ? 'ckc.exe' : 'ckc';
let publicCompiler;
let source = compilerBinaryFromArgs(process.argv.slice(2), process.env);
if (!source) {
  publicCompiler = buildPublicCompiler(compilerLock);
  source = publicCompiler.binary;
  process.on('exit', publicCompiler.cleanup);
}
if (!existsSync(source)) {
  throw new Error('CK server binary not found at ' + source + '.');
}

const version = spawnSync(source, ['--version', '--verbose'], { encoding: 'utf8', timeout: 10000 });
if (version.error || version.status !== 0) {
  throw new Error('Cannot inspect CK server binary: ' + String(version.error ?? version.stderr));
}
const mismatch = validateBinaryIdentity(version.stdout, compilerLock.version, target);
if (mismatch) throw new Error(mismatch);

const bundled = resolve(extensionRoot, 'bin', binaryName);
mkdirSync(dirname(bundled), { recursive: true });
copyFileSync(source, bundled);
if (process.platform !== 'win32') chmodSync(bundled, 0o755);

const vsce = resolve(extensionRoot, 'node_modules/@vscode/vsce/vsce');
const contents = spawnSync(process.execPath, [vsce, 'ls', '--no-dependencies'], {
  cwd: extensionRoot,
  encoding: 'utf8'
});
if (contents.error || contents.status !== 0) {
  throw new Error('Cannot list VSIX contents: ' + String(contents.error ?? contents.stderr));
}
const listed = new Set(contents.stdout.split(/\r?\n/));
const notices = readFileSync(resolve(extensionRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const licenses = spawnSync(pnpm, ['licenses', 'list', '--prod', '--json'], {
  cwd: extensionRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32'
});
if (licenses.error || licenses.status !== 0) {
  throw new Error('Cannot inspect production dependency licenses: ' + String(licenses.error ?? licenses.stderr));
}
const installedLicenses = JSON.parse(licenses.stdout);
const noticeMismatch = validateNotices(notices, installedLicenses);
if (noticeMismatch) throw new Error(noticeMismatch);
const metafile = JSON.parse(readFileSync(resolve(extensionRoot, 'dist/extension.meta.json'), 'utf8'));
const bundleMismatch = validateBundledPackages(metafile, installedLicenses, builtinModules);
if (bundleMismatch) throw new Error(bundleMismatch);
for (const packages of Object.values(installedLicenses)) {
  for (const pkg of packages) {
    for (const version of pkg.versions) {
      const sourceDirectory = pkg.paths?.find((path) => {
        const manifest = resolve(path, 'package.json');
        return existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).version === version;
      });
      if (!sourceDirectory) throw new Error('Cannot find installed license source for ' + pkg.name + '@' + version + '.');
      const sourceFiles = readdirSync(sourceDirectory).filter((file) => /^licen[cs]e(?:\..*)?$/i.test(file));
      if (sourceFiles.length === 0) throw new Error('Cannot find original license file for ' + pkg.name + '@' + version + '.');
      const bundledLicense = readFileSync(resolve(extensionRoot, 'third_party/licenses', pkg.name + '-' + version + '.txt'));
      if (!sourceFiles.some((file) => bundledLicense.equals(readFileSync(resolve(sourceDirectory, file))))) {
        throw new Error('Bundled license text differs from installed ' + pkg.name + '@' + version + '.');
      }
    }
  }
}
for (const file of requiredVsixFiles(binaryName, notices)) {
  if (!listed.has(file)) throw new Error('VSIX would omit required file: ' + file);
}

const out = resolve(extensionRoot, 'out', packageJson.name + '-' + packageJson.version + '-' + target + '.vsix');
mkdirSync(dirname(out), { recursive: true });
const gitTime = spawnSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
  cwd: extensionRoot,
  encoding: 'utf8'
});
if (gitTime.error || gitTime.status !== 0 || !/^\d+$/.test(gitTime.stdout.trim())) {
  throw new Error('Cannot determine a reproducible VSIX timestamp from Git.');
}
const packaged = spawnSync(process.execPath, [vsce, ...vscePackageArgs(packageJson.version, target, out)], {
  cwd: extensionRoot,
  stdio: 'inherit',
  env: { ...process.env, SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? gitTime.stdout.trim() }
});
if (packaged.error || packaged.status !== 0) {
  throw new Error('VSIX packaging failed: ' + String(packaged.error ?? packaged.status));
}
console.log(out);
