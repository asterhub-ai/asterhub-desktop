---
kind: upgrade-guide
description: "Anima adds durable message attribution and model-operation records, moving Session writers to format V5."
---

# Anima session data moves to V5

English | [中文](guide.zh.md)

## Change

Anima adds `anima` source attribution to recalled messages and records its auxiliary extraction, review, and reflection requests and results in the Session log. AsterHub writes Session format V5 to retain this data. Format V4 Sessions remain readable; an older AsterHub build cannot open a V5 Session containing Anima data.

## Migration

No manual conversion is required for existing V4 Sessions. The desktop Host reads each Session through the adjacent V4-to-V5 migration; a writable open publishes a V5 generation beside the unchanged V4 generation. Read-only inspection does not publish a new generation. Install this release before opening a V5 Session on another AsterHub instance. Confirm migration by reopening the Session and verifying its earlier messages still appear before continuing the Anima workflow. The [persistence record](../../../persistence-changes/2026-10-18-anima-session-v5.md) documents the changed fields and checks.
