import { describe, expect, it } from 'vitest';
import { validateServerVersion } from '../src/serverVersion';

describe('validateServerVersion', () => {
  it('accepts the public development compiler version', () => {
    expect(validateServerVersion('ckc 0.15.0-dev.0\n')).toBeUndefined();
    expect(validateServerVersion('ckc 0.15.1\n')).toBeUndefined();
  });

  it('rejects the older compiler release without the language server', () => {
    expect(validateServerVersion('ckc 0.14.0\n')).toContain('0.15');
  });

  it('rejects output from an unrelated executable', () => {
    expect(validateServerVersion('hello world\n')).toContain('ckc');
  });
});
