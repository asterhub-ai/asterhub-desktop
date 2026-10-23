---
kind: upgrade-guide
description: "Replace project-and-session attachment scopes with trusted SessionId-only scopes."
---

# Session-only attachment scopes

English | [中文](guide.zh.md)

## Change

Attachment APIs no longer accept a caller-supplied `projectId`. `AttachmentScope` now contains only the trusted `sessionId`; the mounted attachment provider resolves project ownership and validates project status. A grouped provider without ProjectStorage retains global storage behavior, while a routed request cannot fall back to global storage after ProjectStorage becomes unavailable.

This is a source-level breaking change for extensions and integrations that construct attachment scopes.

## Migration

1. Replace `{ projectId, sessionId }` with `{ sessionId }` for calls to `saveImage`, `saveImages`, `readImage`, `readImageRequest`, file admission/storage, and file reads. Use the SessionId from the receiving Host or Agent; do not derive a project ID in the caller.
2. Remove imports of `ProjectAttachmentScope` and `resolveProjectAttachmentScope` from `@deepseek-ai/dsh-project-storage`; ownership lookup is provider-owned.
3. Rebuild against the updated `@deepseek-ai/dsh-attachment` types and update mocks/test providers to implement SessionId-only routing. Confirm the configured ProjectStorage and attachment provider are mounted together when project ownership is required.
