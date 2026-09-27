# AsterHub Desktop

AsterHub 桌面工作台：基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`，MIT）fork 改造的桌面端 AI 工作台。上游采用 **everything-is-a-plugin** 架构，基于 [Cordis](https://github.com/cordiverse/cordis)；我们在此基础上替换模型接入与账户体系，并完成品牌化改造。

> 上游处于 developer preview 阶段，接口可能变动。本仓库固定在 `dsh-v0.1.6-alpha.2` 基线（commit `ddefc45`）上自行演进，上游文档仅作参考：https://deepseek-harness.github.io/deepseek-harness/

## 仓库结构

- `master` 分支：上游基线镜像，不做定制修改。
- `asterhub` 分支：**定制开发线**，所有 AsterHub 改造都在这条分支上。
- `origin` = https://github.com/asterhub-ai/asterhub-desktop.git ；`upstream` = deepseek-ai/deepseek-harness（用于 cherry-pick 上游修复）。

## 技术栈

- TypeScript / Node.js 22.19+ 或 24+ / pnpm（经 corepack，锁定 11.7.0）
- 桌面：Electron（壳）+ 本地 Host 子进程 + 内置 Web 应用
- Web：React + Vite
- 服务端组合：Cordis 插件体系（组合文件 `packages/bundle/*/cordis.patch.yml`）
- 模型接入：`llm-pi-ai`（OpenAI-compatible 路由）→ sub2api 网关
- 凭证：`credentials-local`（`$DSH_HOME/.credentials.yaml`）

## 与上游的差异（修改方向）

1. **模型接入**：移除 `llm-deepseek`、DeepSeek 搜索、会话日志上报、插件清单上报与 OTel 遥测（DeepSeek 端点）；`llm-pi-ai` 预置 `sub2api` 路由（OpenAI 兼容，默认 `https://xapi.fans/v1`，可用环境变量 `ASTERHUB_MODEL_BASE_URL` 覆盖），默认模型 `aster`。
2. **账户体系**：账户由 sub2api 托管验证；本地不建多用户机制，凭证库只存一条 sub2api key（`SUB2API_API_KEY` 引用）。设置中"模型"区已改为"账户"区（进行中，见已知问题）。
3. **去官方生态**：移除内测弹窗与 DeepSeek 引导弹窗；"插件"入口（侧栏 + 设置）与 DSH 官方插件生态解耦，替换为占位页，后续接入 AsterHub 自有插件功能。
4. **Agent 预设取消**：不挂载预设选择器，宿主强制按默认预设（standard）组装新会话。
5. **品牌**：全面替换为 AsterHub（壳层文案、About、窗口标题、PWA manifest、侧栏/hero 品牌槽、User-Agent 等）；图标为占位 SVG，待正式美术素材。

## 构建与运行

```bash
# pnpm 不在全局 PATH 时（corepack enable 写 Program Files 需要管理员）：
corepack enable --install-directory "$HOME/.corepack-bin" pnpm
export PATH="$HOME/.corepack-bin:$PATH"

pnpm install          # 首次安装依赖
pnpm run build        # 全量构建（根脚本，会连带生成 typert 产物）
pnpm run start:desktop  # 启动桌面端（跳过重建；dev:desktop 会重跑根构建）
```

环境变量（可选）：

- `ASTERHUB_MODEL_BASE_URL`：覆盖模型网关地址（默认 `https://xapi.fans/v1`）。
- `SUB2API_API_KEY`：直接注入模型 key（正式使用由"账户"登录流程写入凭证库）。
- `ASTERHUB_AUTH_BASE_URL`：覆盖账户控制面地址（默认 `https://xapi.fans/api/v1`）。

## 已知问题与进行中事项

- 设置 → 账户：界面已挂载，但显示"账户服务不可用"——客户端尚未解析到 `accountSub2api` 远程命名空间，根因与修复方向见 [docs/交接文档.md](docs/交接文档.md)。
- 图标为占位 SVG；PNG/ICO/安装器素材待正式美术提供后重新生成。
- 上游遗留的 DeepSeek 相关 e2e 测试（`apps/web/tests/scaffold.ts` 等）引用了已移除的组合行，不影响运行时，待清理。

## 许可

MIT。基于 DeepSeek Harness 的修改遵循其原许可证约定，DeepSeek 的版权与许可声明保留于对应文件与 NOTICE 中。
