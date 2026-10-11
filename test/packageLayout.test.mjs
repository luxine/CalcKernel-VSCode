import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requiredVsixFiles, validateNoCompilerCheckoutInVsix } from '../scripts/packageCore.mjs';

test('VSIX listing excludes a compiler checkout while retaining all required extension files', () => {
  const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const root = mkdtempSync(join(tmpdir(), 'ck-vsix-layout-'));
  const compilerCheckout = join(root, 'CalcKernel');

  try {
    assert.equal(existsSync(compilerCheckout), false, 'the fixture must never replace an existing compiler checkout');
    cpSync(join(extensionRoot, '.vscodeignore'), join(root, '.vscodeignore'));
    cpSync(join(extensionRoot, 'package.json'), join(root, 'package.json'));

    const notices = readFileSync(join(extensionRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    const requiredFiles = requiredVsixFiles('ckc', notices);
    assert.equal(requiredFiles.length, 20, 'the required-file contract contains 20 extension files');
    for (const file of requiredFiles) {
      const destination = join(root, file);
      mkdirSync(dirname(destination), { recursive: true });
      if (file === 'bin/ckc' || file === 'dist/extension.cjs') {
        writeFileSync(destination, 'packaging fixture\n');
      } else {
        cpSync(join(extensionRoot, file), destination);
      }
    }
    for (const file of ['SECURITY.md', 'SECURITY.zh-CN.md']) {
      cpSync(join(extensionRoot, file), join(root, file));
    }
    writeFileSync(join(root, 'dist/extension.cjs.map'), '{"version":3,"sources":[],"mappings":""}\n');

    mkdirSync(join(compilerCheckout, 'src'), { recursive: true });
    writeFileSync(join(compilerCheckout, 'src/lib.rs'), 'pub fn fixture() {}\n');
    mkdirSync(join(compilerCheckout, 'target/release'), { recursive: true });
    writeFileSync(join(compilerCheckout, 'target/release/ckc'), 'compiler fixture\n');

    const vsce = join(extensionRoot, 'node_modules', '@vscode', 'vsce', 'vsce');
    const result = spawnSync(process.execPath, [vsce, 'ls', '--no-dependencies'], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));

    const listedFiles = result.stdout.split(/\r?\n/).filter(Boolean);
    assert.equal(validateNoCompilerCheckoutInVsix(listedFiles), undefined);
    assert.deepEqual(
      requiredFiles.filter((file) => !listedFiles.includes(file)),
      [],
      'the VSIX listing must keep all required production files'
    );
    assert.deepEqual(
      listedFiles.filter((file) => file === 'CalcKernel' || file.startsWith('CalcKernel/')),
      [],
      'the VSIX listing must exclude the compiler checkout and build output'
    );
    assert.equal(listedFiles.length, 23, 'the VSIX listing must keep the 23-file production payload');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
