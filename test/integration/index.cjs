const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

function waitForDiagnostics(uri, predicate) {
  const current = vscode.languages.getDiagnostics(uri);
  if (predicate(current)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      listener.dispose();
      reject(new Error('Timed out waiting for CK diagnostics'));
    }, 15000);
    const listener = vscode.languages.onDidChangeDiagnostics((event) => {
      if (!event.uris.some((changed) => changed.toString() === uri.toString())) return;
      const diagnostics = vscode.languages.getDiagnostics(uri);
      if (!predicate(diagnostics)) return;
      clearTimeout(timer);
      listener.dispose();
      resolve(diagnostics);
    });
  });
}

async function waitForWorkspaceSymbol(name, uri) {
  let last = [];
  for (let attempt = 0; attempt < 50; attempt++) {
    const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', name);
    last = symbols.map((symbol) => ({ name: symbol.name, uri: symbol.location.uri.toString() }));
    if (symbols.some((symbol) => symbol.name === name &&
      fs.realpathSync(symbol.location.uri.fsPath) === fs.realpathSync(uri.fsPath))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for unopened CK workspace symbol: ' + name + '; got ' + JSON.stringify(last) + '; folders ' + JSON.stringify(vscode.workspace.workspaceFolders?.map((folder) => folder.uri.toString())));
}

exports.run = async function run() {
  const server = process.env.CK_VSCODE_TEST_CKC;
  if (server) {
    await vscode.workspace.getConfiguration('ck').update('server.path', server, vscode.ConfigurationTarget.Global);
  }
  const folder = process.env.CK_VSCODE_TEST_WORKSPACE ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ck-vscode-test-'));
  const file = path.join(folder, 'sample.ck');
  const unopened = path.join(folder, 'unopened.ck');
  try {
    fs.writeFileSync(file, '@\n');
    fs.writeFileSync(unopened, 'fn workspace_only() -> i32 { return 4; }\n');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(document);
    const extension = vscode.extensions.getExtension('Luxine.calckernel-vscode-plugin');
    assert.ok(extension, 'CalcKernel extension must be discoverable');
    await extension.activate();
    const invalid = await waitForDiagnostics(document.uri, (items) => items.some((item) => item.code === 'CK0001'));
    assert.ok(invalid.some((item) => item.source === 'ckc'));

    const sample = 'fn add(left: i32, right: i32) -> i32 {\n  return left + right;\n}\n' +
      'fn main() -> i32 {\n  return add(1, 2);\n}\n';
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      sample);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    await waitForDiagnostics(document.uri, (items) => items.length === 0);

    const call = document.positionAt(sample.indexOf('add(1, 2)') + 1);
    const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', document.uri, call);
    assert.ok(definitions.some((location) => location.range.start.line === 0), 'go to definition resolves add');

    const references = await vscode.commands.executeCommand('vscode.executeReferenceProvider', document.uri, call, { includeDeclaration: true });
    assert.ok(references.length >= 2, 'find references includes the declaration and call');

    const rename = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', document.uri, call, 'sum');
    assert.equal(rename.get(document.uri).length, 2, 'rename covers declaration and call');

    const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, call);
    assert.ok(hovers.some((hover) => hover.contents.some((content) => String(content.value ?? content).includes('fn add'))),
      'hover shows the CK function signature');

    const completion = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', document.uri,
      document.positionAt(sample.indexOf('return add') + 'return '.length));
    assert.ok(completion.items.some((item) => item.label === 'add'), 'completion offers the CK function');

    const signature = await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', document.uri,
      document.positionAt(sample.indexOf('add(1, 2)') + 'add(1, '.length));
    assert.ok(signature.signatures.some((item) => item.label.includes('add(')), 'signature help shows parameters');

    const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
    assert.ok(symbols.some((item) => item.name === 'add'), 'Outline includes CK declarations');

    const formatting = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', document.uri, {
      tabSize: 2, insertSpaces: true
    });
    assert.ok(formatting.length > 0, 'formatting returns a CK text edit');
    const tabFormatting = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', document.uri, {
      tabSize: 4, insertSpaces: false
    });
    assert.ok(tabFormatting.some((item) => item.newText.includes('\t')),
      'formatting follows VS Code tab indentation settings');
    await vscode.commands.executeCommand('ck.check');
    await waitForWorkspaceSymbol('workspace_only', vscode.Uri.file(unopened));
    await vscode.commands.executeCommand('ck.showOutput');
  } finally {
    if (!process.env.CK_VSCODE_TEST_WORKSPACE) fs.rmSync(folder, { recursive: true, force: true });
  }
};
