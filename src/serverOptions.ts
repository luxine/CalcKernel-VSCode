import type { ServerOptions } from 'vscode-languageclient/node';

export function createServerOptions(command: string): ServerOptions {
  return { command, args: ['lsp'] };
}
