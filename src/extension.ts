import { spawn, execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { basename, dirname, join, parse } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions } from 'vscode-languageclient/node';
import { canExecuteDocument, commandArgs, type ArtifactKind, type CkCommand } from './commands';
import { resolveCompilerPath, resolveServer } from './serverPath';
import { createServerOptions } from './serverOptions';
import { validateServerVersion } from './serverVersion';

const execFileAsync = promisify(execFile);
let client: LanguageClient | undefined;
let output: vscode.LogOutputChannel | undefined;
let activeServerCommand: string | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('CalcKernel', { log: true });
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('ck.restartServer', () => restartServer(context)),
    vscode.commands.registerCommand('ck.showOutput', () => output?.show(true)),
    vscode.commands.registerCommand('ck.check', () => runCurrentFile('check')),
    vscode.commands.registerCommand('ck.run', () => runCurrentFile('run')),
    vscode.commands.registerCommand('ck.build', () => runCurrentFile('build'))
  );
  await startServer(context);
}

export async function deactivate(): Promise<void> {
  const previous = client;
  client = undefined;
  activeServerCommand = undefined;
  if (previous) await previous.stop();
}

async function restartServer(context: vscode.ExtensionContext): Promise<void> {
  await deactivate();
  await startServer(context);
}

function executableExists(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function startServer(context: vscode.ExtensionContext): Promise<void> {
  const configuredPath = vscode.workspace.getConfiguration('ck').get<string>('server.path', '');
  const resolution = resolveServer({
    configuredPath,
    extensionPath: context.extensionPath,
    cwd: process.cwd(),
    platform: process.platform,
    pathEnv: process.env.PATH ?? '',
    fileExists: executableExists
  });
  if (resolution.source === 'missing') {
    output?.warn(resolution.error);
    void vscode.window.showWarningMessage(resolution.error, 'Open Settings').then((selection) => {
      if (selection === 'Open Settings') {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'ck.server.path');
      }
    });
    return;
  }

  try {
    const version = await execFileAsync(resolution.command, ['--version'], { timeout: 5000 });
    const mismatch = validateServerVersion(version.stdout);
    if (mismatch) {
      output?.error(mismatch);
      void vscode.window.showErrorMessage(mismatch);
      return;
    }
  } catch (error) {
    output?.error('Cannot start CK server: ' + String(error));
    void vscode.window.showErrorMessage('Cannot run CK server. See CK: Show Output.');
    return;
  }

  const serverOptions = createServerOptions(resolution.command);
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'calckernel' }],
    outputChannel: output
  };
  const next = new LanguageClient('calckernel', 'CalcKernel', serverOptions, clientOptions);
  try {
    await next.start();
    client = next;
    activeServerCommand = resolution.command;
    output?.info('CK language server started from ' + resolution.source + '.');
  } catch (error) {
    output?.error('CK language server failed: ' + String(error));
    void vscode.window.showErrorMessage('CK language server failed. See CK: Show Output.');
  }
}

async function runCurrentFile(command: CkCommand): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !canExecuteDocument(editor.document.uri.scheme, editor.document.languageId, editor.document.fileName)) {
    void vscode.window.showWarningMessage('Open a local .ck file first.');
    return;
  }
  if (!(await editor.document.save()) || editor.document.isUntitled) return;

  let kind: ArtifactKind | undefined;
  let destination: string | undefined;
  if (command === 'build') {
    kind = await vscode.window.showQuickPick(
      ['executable', 'dynamic', 'static', 'object'],
      { placeHolder: 'Choose a Native artifact kind' }
    ) as ArtifactKind | undefined;
    if (!kind) return;
    const stem = parse(basename(editor.document.fileName)).name;
    const defaultUri = vscode.Uri.file(join(dirname(editor.document.fileName), stem));
    const selected = await vscode.window.showSaveDialog({ defaultUri, saveLabel: 'Build CK artifact' });
    if (!selected) return;
    destination = selected.fsPath;
  }

  let executable: string | undefined;
  if (command === 'check') {
    executable = activeServerCommand;
  } else {
    const compiler = resolveCompilerPath(
      vscode.workspace.getConfiguration('ck').get<string>('compiler.path', ''),
      process.platform,
      executableExists,
      process.env.PATH ?? '',
      process.cwd()
    );
    if ('error' in compiler) {
      void vscode.window.showErrorMessage(compiler.error);
      return;
    }
    executable = compiler.command;
  }
  if (!executable) {
    void vscode.window.showWarningMessage('CK server is unavailable. Set ck.server.path.');
    return;
  }
  if (command !== 'check') {
    try {
      const version = await execFileAsync(executable, ['--version'], { timeout: 5000 });
      const mismatch = validateServerVersion(version.stdout);
      if (mismatch) {
        void vscode.window.showErrorMessage(mismatch);
        return;
      }
    } catch (error) {
      output?.error('Cannot run CK compiler: ' + String(error));
      void vscode.window.showErrorMessage('Cannot run CK compiler. See CK: Show Output.');
      return;
    }
  }
  const args = commandArgs(command, editor.document.fileName, kind, destination);
  const channel = output;
  channel?.show(true);
  channel?.info('Running ckc ' + args.join(' '));
  await new Promise<void>((resolve) => {
    const child = spawn(executable, args, {
      cwd: dirname(editor.document.fileName),
      shell: false
    });
    child.stdout.on('data', (chunk: Buffer) => channel?.append(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => channel?.append(chunk.toString()));
    child.once('error', (error) => {
      channel?.error('Cannot run ckc: ' + String(error));
      resolve();
    });
    child.once('close', (code) => {
      channel?.info('ckc exited with status ' + String(code) + '.');
      resolve();
    });
  });
}
