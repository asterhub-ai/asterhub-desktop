---
kind: upgrade-guide
description: "Replace the Desktop optional Schedule Bundle with AsterHub's built-in scheduled tasks."
---

# Desktop scheduled tasks

English | [中文](guide.zh.md)

## Change

AsterHub Desktop includes native scheduled tasks and a permanent Scheduled Tasks entry below Plugins. Each occurrence creates a fresh conversation; the optional DSH Schedule Bundle's original-conversation delivery is not used by Desktop. Other profiles retain their existing Schedule composition.

Desktop preserves stored legacy reminders, Session logs and unrelated installed plugins. It does not automatically convert a legacy reminder into a native task because the account, model, workspace and independently executable instruction require user confirmation. A Desktop patch explicitly mounting the old Schedule service or UI conflicts with the native composition and must be corrected before scheduling starts.

## Migration

1. Preserve a backup of the Desktop profile configuration before upgrading. Do not delete the old Schedule task store or Session files.
2. Open **Scheduled Tasks** below **Plugins**. Review the legacy-reminder notice, then use **New Task** or chat to recreate each reminder you still need, selecting its workspace, model and timezone. Check the next execution times before confirming.
3. If startup reports an explicit old Schedule configuration, remove only those old Schedule entries from your Desktop profile patch after backing it up. Preserve unrelated plugin entries and dependencies; do not uninstall packages merely to hide the warning.
4. Verify a task's saved definition and first run in the task panel. Its result opens in a separate conversation. Hiding Desktop to the tray keeps scheduling active; fully exiting the app or shutting down the computer stops it until Host starts again.
5. Do not downgrade over a profile that has completed the native scheduling cutover. An older installation may not recognize the cutover marker. Restore a verified pre-upgrade configuration only as part of a separately reviewed downgrade; native task data is not a legacy Schedule store.
