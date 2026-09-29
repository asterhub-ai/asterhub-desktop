# AsterHub 桌面版

[English](README.md) | 中文

AsterHub 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，MIT）fork 改造的桌面 AI 工作台。上游基于 [Cordis](https://github.com/cordiverse/cordis)，采用**一切皆插件**架构；本项目固定模型鉴权入口并完成 AsterHub 品牌改造。

> 上游仍处于开发者预览阶段，接口可能变化。本仓库以 `dsh-v0.1.6-alpha.2` 为基线独立演进；上游文档仅作参考：https://deepseek-harness.github.io/deepseek-harness/

## 仓库结构

- `master`：上游基线镜像，不承载定制修改。
- `asterhub`：AsterHub 定制开发线。
- `origin`：[https://github.com/asterhub-ai/asterhub-desktop.git](https://github.com/asterhub-ai/asterhub-desktop.git)；`upstream`：deepseek-ai/deepseek-harness，用于挑选上游修复。

## 技术栈

- TypeScript；Node.js 22.19+ 或 24+；pnpm 11.7.0（经 Corepack）。
- 桌面端：Electron、本地 Host 子进程和内置 Web 应用。
- Web：React + Vite。
- Host 组合：Cordis 插件体系，组合文件位于 `packages/bundle/*/cordis.patch.yml`。
- 模型适配：`llm-pi-ai` 的 OpenAI 兼容协议适配器，经 Sub2API 网关调用。
- 凭据存储：`credentials-local`，文件位于 `$DSH_HOME/.credentials.yaml`。

## AsterHub 产品约束

1. **固定模型入口**：Desktop Host 在 profile 配置装载前固定 provider `sub2api`、Base URL `https://xapi.fans/v1` 和模型 `aster`。Session、设置、环境变量、Workflow 与子 Agent 参数均不能改写内置 DSH 模型路由。模型 key 只从成功登录后写入的 Host credential record 读取。
2. **账户鉴权**：账户由 Sub2API 托管验证。账户 token 和模型 key 保留在 Host，不下发给 renderer；登录控制面固定为 `https://xapi.fans/api/v1`。
3. **插件和 MCP**：对话可按用户请求从任意来源安装、卸载和启停插件/MCP bundle，继续使用 Host 操作审批及依赖脚本审批。应用侧栏的“插件”页单独读取签名精选目录；它只按目录 id 安装精确包版本并校验 lockfile integrity。
4. **桌面更新**：新安装包的 electron-updater feed 和强制更新策略使用 `https://asterhub.xapi.fans`。只读目录/更新服务源码在 `services/asterhub-catalog/`；DNS 与德国主机尚未部署，现有安装包不会自动切换 feed。
5. **Agent 预设**：不展示预设切换器，新会话使用 `standard`。
6. **品牌**：壳层文案、About、窗口标题、PWA manifest、侧栏、欢迎区和 User-Agent 使用 AsterHub 品牌；应用图标仍是占位素材，正式美术完成后应重新生成 PNG/ICO/安装器资源。

## 构建与运行

<a id="run"></a>

<a id="run-from-source"></a>

```bash
# pnpm 不在全局 PATH 时（corepack enable 写 Program Files 需要管理员）：
corepack enable --install-directory "$HOME/.corepack-bin" pnpm
export PATH="$HOME/.corepack-bin:$PATH"

pnpm install          # 首次安装依赖
pnpm run build        # 全量构建（根脚本，会连带生成 typert 产物）
pnpm run start:desktop  # 启动桌面端（跳过重建；dev:desktop 会重跑根构建）
```

Desktop 的模型 route、model endpoint 和账户控制面不接受环境变量覆盖。`SUB2API_API_KEY` 仅作为旧 credential reference 的清理/迁移标识，不再是模型请求的 key 来源。

## 当前交付状态

- 德国主机服务 scaffold、签名空目录、Desktop Host release-pinned 公钥和更新 feed 配置均已在工作树；Cloudflare DNS 与德国主机部署仍待执行。精选目录当前为空；发布目录条目时必须用对应私钥签署 payload。新 feed 文件需在部署后放入服务，再构建/发布新的签名安装包；旧版本继续使用其包内原地址。
- 应用图标仍是占位素材；PNG/ICO/安装器素材待正式美术提供后重新生成。
- 上游旧 e2e fixtures 仍引用已移除的组合行，不影响运行时，尚待清理。

## 许可

MIT。基于 DeepSeek Harness 的修改遵循其原许可约定；相关版权和许可声明保留在源文件与 NOTICE 中。
