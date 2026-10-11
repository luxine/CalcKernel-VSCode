import { describe, expect, it } from 'vitest';
import { validateServerVersion } from '../src/serverVersion';

describe('validateServerVersion', () => {
  it('accepts stable releases in the supported 0.15 and 0.16 lines', () => {
    expect(validateServerVersion('ckc 0.15.0\n')).toBeUndefined();
    expect(validateServerVersion('ckc 0.15.1\n')).toBeUndefined();
    expect(validateServerVersion('ckc 0.16.0\n')).toBeUndefined();
    expect(validateServerVersion('ckc 0.16.3\n')).toBeUndefined();
  });

  it('accepts prereleases in both supported minor lines', () => {
    expect(validateServerVersion('ckc 0.15.0-dev.0\n')).toBeUndefined();
    expect(validateServerVersion('ckc 0.16.0-rc.1\n')).toBeUndefined();
  });

  it.each(['0.14.99', '0.17.0', '1.0.0'])('rejects unsupported compiler version %s', (version) => {
    expect(validateServerVersion(`ckc ${version}\n`)).toContain('0.15.x or 0.16.x');
  });

  it.each(['hello world\n', 'ckc 0.16\n', 'ckc 0.16.x\n', 'ckc v0.16.0\n'])
    ('rejects malformed or unrelated version output: %s', (version) => {
      expect(validateServerVersion(version)).toContain('ckc 0.15.x or 0.16.x');
    });
});
