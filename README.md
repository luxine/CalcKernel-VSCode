# CalcKernel for Visual Studio Code

[简体中文](README.zh-CN.md)

CalcKernel adds language support for CK `.ck` files: syntax highlighting, snippets, and live diagnostics from the public CalcKernel compiler. Its language server works with unsaved edits.

Language features include completion, hover, signature help, go to definition, references, safe rename, document and workspace symbols, semantic highlighting, folding, selection ranges, and document formatting. Navigation and rename follow bindings in one CK source file; CK has no imports. Formatting follows the editor's indentation settings, preserves line comments, and leaves incomplete source unchanged.

## Install

Install the **CalcKernel** extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Luxine.calckernel-vscode-plugin), or download a platform-specific VSIX from [GitHub Releases](https://github.com/luxine/CalcKernel-VSCode/releases). Each VSIX bundles a frontend-only `ckc` language server and the `compiler.lock.json` build provenance, so diagnostics work offline and do not require LLVM. A manually configured language server must be `ckc` 0.15.x.

## Build from source

The extension repository is self-contained. A local package build checks out the public compiler commit and compiler version recorded in [`compiler.lock.json`](compiler.lock.json), builds its frontend-only `ckc`, and bundles the binary for the current platform.

Requirements: Git, Rust stable, Node.js 22, and pnpm 11.7.0.

```sh
git clone https://github.com/luxine/CalcKernel-VSCode.git
cd CalcKernel-VSCode
pnpm install --frozen-lockfile
pnpm test
pnpm package
```

To use a prebuilt public compiler instead, pass its absolute path:

```sh
CK_VSCODE_CKC_BINARY=/absolute/path/to/ckc pnpm package
```

The compiler source revision is public and pinned. Builds depend only on this repository and that public compiler commit.

## Settings and commands

- `ck.server.path`: absolute path to a compatible `ckc` for language features. Empty uses the bundled binary, then PATH.
- `ck.compiler.path`: absolute path to a Native-enabled `ckc` for Run and Build. Empty uses PATH.
- `CK: Check Current File`, `CK: Run Current File`, `CK: Build Current File`, `CK: Restart Language Server`, and `CK: Show Output` appear in the Command Palette.

Run and Build require a file-backed `.ck` document and save it before invoking the compiler. The language server uses unsaved text for diagnostics. Virtual workspaces retain static highlighting and snippets; compiler commands require local files.

The extension does not download compilers or build Rust code when VS Code activates it.
