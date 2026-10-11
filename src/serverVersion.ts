export const SUPPORTED_CKC_MINOR_LINES = ['0.15', '0.16'] as const;

const supportedVersions = SUPPORTED_CKC_MINOR_LINES.map((minor) => minor + '.x').join(' or ');

export function validateServerVersion(versionOutput: string): string | undefined {
  const match = /^ckc (\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\s|$)/.exec(versionOutput.trim());
  if (!match) {
    return 'Expected ckc ' + supportedVersions + '; the selected executable did not report a supported ckc version.';
  }
  if (!SUPPORTED_CKC_MINOR_LINES.includes((match[1] + '.' + match[2]) as typeof SUPPORTED_CKC_MINOR_LINES[number])) {
    return 'Expected ckc ' + supportedVersions + ', found ' + match[0].trim() + '.';
  }
  return undefined;
}
