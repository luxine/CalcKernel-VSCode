# Contributing

[简体中文](CONTRIBUTING.zh-CN.md)

## Development checks

Follow the setup in [README.md](README.md). Before opening a pull request, run:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm package
```

The package command builds the compiler pinned in `compiler.lock.json`. The six-platform workflow also checks the extension against that exact public compiler commit.

## Updating the compiler pin

Set `repository` to the canonical public CalcKernel repository, `commit` to a full commit SHA available there, and `version` to the version reported by that commit's `ckc --version --verbose`. CI rebuilds the compiler from that commit and rejects a binary with a different version or target.

## Releases

Update `package.json` to the intended extension version and push a matching `v<version>` tag. CI builds and tests all six platform packages from the tagged extension source and the compiler commit pinned in `compiler.lock.json`, then creates a GitHub Release with the VSIX files. Marketplace publication uses the repository secret `VSCE_PAT`; the release workflow skips that publication when the secret is not configured. Release builds use the checked out public compiler and must not substitute a locally supplied binary.

If Marketplace publication is only partially successful after the GitHub Release exists, retry it from the same tag with:

```sh
gh workflow run vscode-extension.yml --ref v<version> -f publish_marketplace=true
```

The retry publishes the VSIX files downloaded from that existing release and skips packages already published.
