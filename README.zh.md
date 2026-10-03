# AsterHub

[English](README.md) | 中文

AsterHub 是面向日常工作的桌面 AI 工作台，基于插件化 Cordis 运行时构建。

它构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。

产品与桌面开发说明：[桌面版交接文档](交接文档.zh.md) · [桌面开发指南](apps/desktop/README.zh.md)

## 开发者预览

AsterHub 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

<a id="run-from-source"></a>

### 从源码运行

在仓库检出目录中构建并启动 AsterHub 桌面应用：

```sh
pnpm install
pnpm run dev:desktop
```

单独的 `dev:web` 命令用于渲染层开发，会启动 Web 开发宿主；它不是面向客户的产品入口。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:desktop` 构建并启动桌面应用；`pnpm run dev:web` 用于单独调试渲染层。`make help` 列出对应的开发命令，完整说明见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
