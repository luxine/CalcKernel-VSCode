# CalcKernel Visual Studio Code 扩展

[English](README.md)

CalcKernel 为 CK `.ck` 文件提供语言支持，包括语法高亮、代码片段，以及由公开 CalcKernel 编译器生成的实时诊断。语言服务可检查尚未保存的修改。

语言功能包括补全、悬停、签名帮助、转到定义、查找引用、安全重命名、文档与工作区符号、语义高亮、折叠、选择范围及文档格式化。导航和重命名基于单个 CK 源文件的绑定关系；CK 没有导入语法。格式化遵循编辑器的缩进设置，保留行注释，并在源代码不完整时保持原文。

## 安装

从 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Luxine.calckernel-vscode-plugin) 安装 **CalcKernel** 扩展，或从 [GitHub Releases](https://github.com/luxine/CalcKernel-VSCode/releases) 下载对应平台的 VSIX。每个 VSIX 都包含仅启用前端的 `ckc` 语言服务和 `compiler.lock.json` 构建来源记录，因此诊断可离线工作且不需要 LLVM。手动配置的语言服务端须为 `ckc` 0.15.x。

## 从源码构建

扩展仓库可以独立使用。本地打包会检出 [`compiler.lock.json`](compiler.lock.json) 中记录的公开编译器提交和版本，构建其前端 `ckc`，并将对应当前平台的程序放入安装包。

所需工具：Git、Rust stable、Node.js 22 和 pnpm 11.7.0。

```sh
git clone https://github.com/luxine/CalcKernel-VSCode.git
cd CalcKernel-VSCode
pnpm install --frozen-lockfile
pnpm test
pnpm package
```

也可传入预先构建的公开编译器绝对路径：

```sh
CK_VSCODE_CKC_BINARY=/absolute/path/to/ckc pnpm package
```

编译器源码提交公开且固定。构建只依赖本仓库和该公开编译器提交。

## Marketplace 预发布

Marketplace 的版本号必须是数字形式 `MAJOR.MINOR.PATCH`，预发布也一样。要发布 `v0.15.0-dev.2` 这样的公开预发布标签，请在 `main` 上运行 **Marketplace numeric pre-release variants** 工作流，并输入已存在的标签；该标签的 GitHub Release 必须已存在且标记为预发布。例如：

```sh
gh workflow run marketplace-prerelease.yml --ref main -f source_tag=v0.15.0-dev.2
```

CI 会严格从标签推导 `0.15.0`，为六个平台打包带有 VS Code 预发布标记的扩展，验证源码与编译器来源，然后将变体和带校验和的来源记录追加到同一个 GitHub Release。原有 `-dev.2` 资产保持不变；若预期变体资产已存在，CI 会拒绝覆盖。从该公开 Release 下载六个 `marketplace-prerelease` VSIX 文件，并在已登录的 Marketplace 发布者界面上传这些原始文件。自动 Marketplace 发布默认关闭；如需启用，可设置仓库变量 `MARKETPLACE_PUBLISH_ENABLED=true` 和 `VSCE_PAT` secret。Marketplace 中的该版本仍是预发布；以后发布正式版必须使用尚未使用过的其他数字版本，例如 `0.15.1`。

## 设置与命令

- `ck.server.path`：语言服务使用的兼容 `ckc` 绝对路径。留空时依次使用安装包内的程序和 PATH。
- `ck.compiler.path`：运行与构建使用的 Native 版 `ckc` 绝对路径。留空时使用 PATH。
- 命令面板提供 `CK: Check Current File`、`CK: Run Current File`、`CK: Build Current File`、`CK: Restart Language Server` 与 `CK: Show Output`。

运行和构建要求本地 `.ck` 文件，并在调用编译器前保存文件。语言服务可直接检查未保存文本。虚拟工作区保留静态高亮和片段；编译器命令要求本地文件。

VS Code 激活扩展时不会下载编译器，也不会自动构建 Rust 代码。
