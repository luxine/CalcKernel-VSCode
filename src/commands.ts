export type CkCommand = 'check' | 'run' | 'build';
export type ArtifactKind = 'executable' | 'dynamic' | 'static' | 'object';

export function canExecuteDocument(scheme: string, languageId: string, fileName: string): boolean {
  return scheme === 'file' && (languageId === 'calckernel' || fileName.endsWith('.ck'));
}

export function commandArgs(command: CkCommand, file: string, kind?: ArtifactKind, output?: string): string[] {
  if (command !== 'build') return [command, file];
  if (!kind || !output) throw new Error('Build kind and output path are required');
  return ['build', file, '--kind', kind, '--out', output];
}
