import { describe, expect, it } from 'vitest';
import { resolveCompilerPath, resolveServer } from '../src/serverPath';

describe('resolveServer', () => {
  const base = {
    extensionPath: '/extension',
    cwd: '/extension-host',
    platform: 'darwin' as const,
    pathEnv: '/usr/local/bin:/usr/bin',
    fileExists: (path: string) => path === '/extension/bin/ckc' || path === '/usr/bin/ckc'
  };

  it('uses an explicit executable path first', () => {
    expect(resolveServer({ ...base, configuredPath: '/custom/ckc', fileExists: (path) => path === '/custom/ckc' }))
      .toEqual({ command: '/custom/ckc', source: 'configured' });
  });

  it('reports an invalid explicit path without silently falling back', () => {
    expect(resolveServer({ ...base, configuredPath: '/missing/ckc' }))
      .toEqual({ source: 'missing', error: 'Configured CK server not found: /missing/ckc' });
  });

  it('rejects relative configured paths before probing or launching', () => {
    expect(resolveServer({ ...base, configuredPath: './bin/ckc' }))
      .toEqual({ source: 'missing', error: 'ck.server.path must be an absolute path.' });
  });

  it('uses the bundled server before PATH', () => {
    expect(resolveServer({ ...base, configuredPath: '' }))
      .toEqual({ command: '/extension/bin/ckc', source: 'bundled' });
  });

  it('uses PATH when no bundled server exists', () => {
    expect(resolveServer({ ...base, configuredPath: '', fileExists: (path) => path === '/usr/bin/ckc' }))
      .toEqual({ command: '/usr/bin/ckc', source: 'path' });
  });

  it('returns an absolute command for relative PATH entries', () => {
    expect(resolveServer({
      ...base,
      configuredPath: '',
      pathEnv: 'bin',
      fileExists: (path) => path === '/extension-host/bin/ckc' || path === 'bin/ckc'
    })).toEqual({ command: '/extension-host/bin/ckc', source: 'path' });
  });

  it('reports a missing server', () => {
    expect(resolveServer({ ...base, configuredPath: '', fileExists: () => false }))
      .toEqual({ source: 'missing', error: 'CK server not found. Set ck.server.path or install ckc.' });
  });
});

describe('resolveCompilerPath', () => {
  it('resolves the Native compiler on PATH to one absolute executable', () => {
    expect(resolveCompilerPath('', 'darwin', (path) => path === '/usr/bin/ckc', '/usr/bin', '/host'))
      .toEqual({ command: '/usr/bin/ckc' });
  });

  it('rejects relative configured paths that would change with source directory', () => {
    expect(resolveCompilerPath('./build/ckc', 'darwin', () => true, '', '/host'))
      .toEqual({ error: 'ck.compiler.path must be an absolute path.' });
  });

  it('uses an existing absolute Native compiler path', () => {
    expect(resolveCompilerPath('/tools/ckc', 'darwin', (path) => path === '/tools/ckc', '', '/host'))
      .toEqual({ command: '/tools/ckc' });
  });

  it('anchors relative PATH entries before checking the version or executing', () => {
    expect(resolveCompilerPath('', 'darwin', (path) => path === '/host/bin/ckc', 'bin', '/host'))
      .toEqual({ command: '/host/bin/ckc' });
  });
});
