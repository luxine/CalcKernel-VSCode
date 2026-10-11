import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/vscode-extension.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

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

if (process.env.CK_VSCODE_WORKFLOW_EOL_CHILD !== '1') {
  test('the workflow contract loads from LF and CRLF checkout layouts', () => {
    const workflowSource = readFileSync(new URL('../.github/workflows/vscode-extension.yml', import.meta.url), 'utf8')
      .replace(/\r?\n/g, '\n');
    const testSource = readFileSync(new URL(import.meta.url), 'utf8');

    for (const newline of ['\n', '\r\n']) {
      const root = mkdtempSync(join(tmpdir(), 'ck-workflow-eol-'));
      try {
        const workflowPath = join(root, '.github', 'workflows', 'vscode-extension.yml');
        const testPath = join(root, 'test', 'workflowContract.test.mjs');
        mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
        mkdirSync(join(root, 'test'), { recursive: true });
        writeFileSync(workflowPath, workflowSource.replace(/\n/g, newline));
        writeFileSync(testPath, testSource);

        const childEnvironment = { ...process.env, CK_VSCODE_WORKFLOW_EOL_CHILD: '1' };
        delete childEnvironment.NODE_TEST_CONTEXT;
        const result = spawnSync(process.execPath, ['--test', 'test/workflowContract.test.mjs'], {
          cwd: root,
          encoding: 'utf8',
          env: childEnvironment
        });
        assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
}
