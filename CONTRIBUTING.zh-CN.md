# 参与贡献

[English](CONTRIBUTING.md)

## 开发检查

请按 [README.zh-CN.md](README.zh-CN.md) 设置环境。提交 pull request 前运行：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm package
```

打包命令会构建 `compiler.lock.json` 固定的编译器。六平台工作流也会使用该公开编译器提交检查扩展。

## 更新编译器锁定版本

将 `repository` 设为规范的公开 CalcKernel 仓库，将 `commit` 设为该仓库可访问的完整提交 SHA，并将 `version` 设为该提交中 `ckc --version --verbose` 报告的版本。CI 会从该提交重新构建编译器，并拒绝版本或目标平台不匹配的二进制文件。

## 发布

将 `package.json` 更新为目标扩展版本，并推送对应的 `v<version>` tag。CI 会基于该扩展源码 tag 和 `compiler.lock.json` 固定的编译器提交构建并测试六个平台安装包，然后创建包含 VSIX 文件的 GitHub Release。Marketplace 发布使用仓库 secret `VSCE_PAT`；未配置该 secret 时工作流会跳过 Marketplace 发布。正式发布构建使用工作流 checkout 的公开编译器，不能替换为本机提供的二进制文件。

如果 Marketplace 发布部分成功且 GitHub Release 已创建，可在同一 tag 上用以下命令重试：

```sh
gh workflow run vscode-extension.yml --ref v<version> -f publish_marketplace=true
```

重试会从已有 release 下载 VSIX，并跳过已发布的安装包。
