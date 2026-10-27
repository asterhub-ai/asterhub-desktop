---
kind: upgrade-guide
description: "将项目与会话组合的附件作用域替换为仅含可信 SessionId 的作用域。"
---

# 仅使用 Session 的附件作用域

[English](guide.md) | 中文

## 变更

附件 API 不再接受调用方提供的 `projectId`。`AttachmentScope` 现在仅包含可信 `sessionId`；已挂载的附件提供方负责解析项目归属并校验项目状态。未挂载 ProjectStorage 的分组提供方仍使用全局存储；ProjectStorage 不可用后，已路由请求不得回退至全局存储。

此变更会破坏自行构造附件作用域的扩展和集成的源码兼容性。

## 迁移

1. 将 `saveImage`、`saveImages`、`readImage`、`readImageRequest`、文件准入/存储及文件读取调用中的 `{ projectId, sessionId }` 改为 `{ sessionId }`。使用接收方 Host 或 Agent 的 SessionId；调用方不要自行推导项目 ID。
2. 从 `@deepseek-ai/dsh-project-storage` 删除对 `ProjectAttachmentScope` 和 `resolveProjectAttachmentScope` 的导入；归属查询现在由提供方负责。
3. 根据更新后的 `@deepseek-ai/dsh-attachment` 类型重新构建，并更新 mocks/测试提供方以实现仅基于 SessionId 的路由。需要项目归属时，确认 ProjectStorage 与附件提供方同时挂载。
