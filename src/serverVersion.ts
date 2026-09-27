export const REQUIRED_CKC_MINOR = '0.15';

export function validateServerVersion(versionOutput: string): string | undefined {
  const match = /^ckc (\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\s|$)/.exec(versionOutput.trim());
  if (!match) {
    return 'Expected ckc 0.15.x; the selected executable did not report a ckc version.';
  }
  if (match[1] + '.' + match[2] !== REQUIRED_CKC_MINOR) {
    return 'Expected ckc ' + REQUIRED_CKC_MINOR + '.x, found ' + match[0].trim() + '.';
  }
  return undefined;
}
