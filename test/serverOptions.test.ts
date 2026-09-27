import { expect, it } from 'vitest';
import { createServerOptions } from '../src/serverOptions';

it('starts ckc lsp without languageclient appending an unsupported --stdio flag', () => {
  const options = createServerOptions('/tools/ckc');
  expect(options).toEqual({ command: '/tools/ckc', args: ['lsp'] });
  expect('transport' in options).toBe(false);
});
