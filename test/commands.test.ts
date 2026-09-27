import { describe, expect, it } from 'vitest';
import { canExecuteDocument, commandArgs } from '../src/commands';

describe('commandArgs', () => {
  const file = '/work/CK examples/price.ck';

  it('passes source paths as separate arguments for check and run', () => {
    expect(commandArgs('check', file)).toEqual(['check', file]);
    expect(commandArgs('run', file)).toEqual(['run', file]);
  });

  it('builds a selected native artifact without shell parsing', () => {
    expect(commandArgs('build', file, 'executable', '/tmp/My Output'))
      .toEqual(['build', file, '--kind', 'executable', '--out', '/tmp/My Output']);
  });

  it('rejects an incomplete build request', () => {
    expect(() => commandArgs('build', file)).toThrow('Build kind and output path are required');
  });
});

describe('canExecuteDocument', () => {
  it('accepts local CK source files', () => {
    expect(canExecuteDocument('file', 'calckernel', '/work/kernel.ck')).toBe(true);
  });

  it('rejects virtual and untitled documents for filesystem commands', () => {
    expect(canExecuteDocument('vscode-vfs', 'calckernel', '/repo/kernel.ck')).toBe(false);
    expect(canExecuteDocument('untitled', 'calckernel', 'Untitled-1.ck')).toBe(false);
  });
});
