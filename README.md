# AsterHub Desktop

English | [中文](README.zh.md)

AsterHub 桌面工作台：基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，MIT）fork 改造的桌面端 AI 工作台。上游采用 **everything-is-a-plugin** 架构，基于 [Cordis](https://github.com/cordiverse/cordis)；我们在此基础上替换模型接入与账户体系，并完成品牌化改造。

> 上游处于 developer preview 阶段，接口可能变动。本仓库固定在 `dsh-v0.1.6-alpha.2` 基线上自行演进，上游文档仅作参考：https://deepseek-harness.github.io/deepseek-harness/

## 仓库结构

- `master` 分支：上游基线镜像，不做定制修改。
- `asterhub` 分支：**定制开发线**，所有 AsterHub 改造都在这条分支上。
- `origin` = [https://github.com/asterhub-ai/asterhub-desktop.git](https://github.com/asterhub-ai/asterhub-desktop.git)；`upstream` = deepseek-ai/deepseek-harness（用于 cherry-pick 上游修复）。

## 技术栈

- TypeScript / Node.js 22.19+ 或 24+ / pnpm（经 corepack，锁定 11.7.0）
- 桌面：Electron（壳）+ 本地 Host 子进程 + 内置 Web 应用
- Web：React + Vite
- 服务端组合：Cordis 插件体系（组合文件 `packages/bundle/*/cordis.patch.yml`）
- 模型接入：`llm-pi-ai`（OpenAI-compatible 路由）→ sub2api 网关
- 凭证：`credentials-local`（`$DSH_HOME/.credentials.yaml`）

## 与上游的差异（修改方向）

1. **模型接入**：DSH 内置模型调用固定由 Desktop Host 路由到 `sub2api/aster`、`https://xapi.fans/v1`；Session、settings、环境变量、Workflow 和子 Agent 参数都不能改写该路由。模型 key 只从成功登录后写入的 Host credential record 读取。
2. **账户体系**：账户由 Sub2API 托管验证；本地不建多用户机制。账户 token 与模型 key 保留在 Host 凭据库中，不下发给 renderer。Desktop 登录控制面固定为 `https://xapi.fans/api/v1`。
3. **插件与 MCP**：对话可经 `plugin_manager` 按用户请求从任意来源安装、卸载、启停 DSH 插件/MCP bundle，并保留 Host 操作与依赖脚本审批。侧栏“插件”页单独展示我方签名精选目录，用户点选安装时只接受目录 id，并核对精确包版本和 lockfile integrity。
4. **版本更新**：新 Desktop 安装包的 electron-updater feed 与强制更新策略使用 `https://asterhub.xapi.fans`。该域名的只读目录/更新服务部署包位于 `services/asterhub-catalog/`；服务和 Cloudflare DNS 当前尚未部署，已有安装包不会自动切换到新 feed。
5. **Agent 预设取消**：不挂载预设选择器，宿主强制按默认预设（standard）组装新会话。
6. **品牌**：全面替换为 AsterHub（壳层文案、About、窗口标题、PWA manifest、侧栏/hero 品牌槽、User-Agent 等）；图标为占位 SVG，待正式美术素材。

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

Desktop 模型路由、模型 endpoint 和账户控制面不接受环境变量覆盖。`SUB2API_API_KEY` 仅作为旧 credential-ref 清理/迁移名，不再作为模型请求来源。

## 已知问题与进行中事项

- Germany 主机服务与 `asterhub.xapi.fans` DNS 尚未部署。当前精选目录为空但已有本机签名；发布目录前需把对应 payload/signature 与 Desktop release 公钥配对，更新 feed 文件由操作员放入服务数据目录。
- 图标为占位 SVG；PNG/ICO/安装器素材待正式美术提供后重新生成。
- 上游遗留的 DeepSeek 相关 e2e 测试（`apps/web/tests/scaffold.ts` 等）引用了已移除的组合行，不影响运行时，待清理。

## 许可

MIT。基于 DeepSeek Harness 的修改遵循其原许可证约定，DeepSeek 的版权与许可声明保留于对应文件与 NOTICE 中。
