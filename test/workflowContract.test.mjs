import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/vscode-extension.yml', import.meta.url), 'utf8');

test('non-publishing workflow dispatch retains its six-platform VSIX artifacts', () => {
  const upload = workflow.match(/      - name: Upload VSIX\n([\s\S]*?)(?=\n\n  release:)/)?.[1];
  assert.ok(upload, 'the matrix build must upload its VSIX packages');
  assert.match(upload, /if: >-[\s\S]*startsWith\(github\.ref, 'refs\/tags\/'\)[\s\S]*github\.event_name == 'workflow_dispatch'[\s\S]*inputs\.publish_marketplace != true/);
  assert.match(upload, /uses: actions\/upload-artifact@/);
  assert.match(upload, /path: out\/\*\.vsix/);
});

test('retaining preview VSIX files does not open release or Marketplace jobs', () => {
  const release = workflow.match(/  release:\n([\s\S]*?)(?=\n  marketplace:)/)?.[1];
  const marketplace = workflow.match(/  marketplace:\n([\s\S]*?)(?=\n  marketplace-prerelease-guidance:)/)?.[1];
  assert.ok(release);
  assert.match(release, /if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/'\)/);
  assert.ok(marketplace);
  assert.match(marketplace, /startsWith\(github\.ref, 'refs\/tags\/'\)/);
  assert.match(marketplace, /!contains\(github\.ref_name, '-'\)/);
  assert.match(marketplace, /github\.event_name == 'workflow_dispatch' && inputs\.publish_marketplace/);
});
