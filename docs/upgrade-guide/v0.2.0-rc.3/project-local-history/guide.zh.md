---
kind: upgrade-guide
description: "将默认全局主目录迁移至 .asterhub，并采用项目级会话与附件存储。"
---

# 项目级历史与便携附件

[English](guide.md) | 中文

## 变更

AsterHub 将默认全局主目录从 `~/.dsh` 改为 `~/.asterhub`，同时保留显式 `DSH_HOME` 配置覆盖。每个项目在本地 `<project>/.aster/` 存储会话历史与原始二进制附件，不再写入全局统一目录。

每个项目在 `<project>/.aster/project.json` 中保存便携清单，记录项目身份、会话归属、显示排序及置顶/归档状态。历史会话代际不可变地保留在 `<project>/.aster/sessions/` 下，原始文件和归一化图片保存在 `<project>/.aster/attachments/v1/`。

将项目移动或复制到其他电脑时，通过目录选择器选择文件夹会以只读方式检查，并弹出包含已核验项目信息的确认对话框。当前执行工作目录由当前项目绑定解析，不改写历史 header 中的目录。在写入私有数据前，项目 `.gitignore` 会自动添加 `.aster/` 排除规则。

## 迁移

1. 默认主目录迁移：首次启动时，AsterHub 通过原子锁暂存并复制 `~/.dsh` 中的现有数据到 `~/.asterhub`，记录完成标记并完整保留源 `~/.dsh`。若显式设置了 `DSH_HOME`，配置路径保持优先，不触发迁移。
2. 已有项目发现：在另一台机器上打开复制的项目时，AsterHub 会检测到 `.aster/project.json`，并显示包含项目名称与会话数量的确认对话框。确认后打开已有会话及附件；取消则不产生任何磁盘写入。
3. Git 排除保护：AsterHub 会在项目 `.gitignore` 中追加 `.aster/` 规则（若不存在），同时保留原文件的换行符与格式。若 `.aster/` 之前已提交或暂存到 Git，AsterHub 会发出已跟踪私有数据警告，不会擅自删除或修改 Git 索引。
4. 降级防范：不要在未备份的情况下，使用不支持项目级存储的旧版本 AsterHub 打开含有 `.aster/` 数据的项目。
