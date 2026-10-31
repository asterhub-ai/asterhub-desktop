---
kind: upgrade-guide
description: "Session writing regresses to upstream format V4; fork-period V5-head logs and interim V4 logs with anima events no longer open."
---

# Session format regresses to V4

English | [中文](guide.zh.md)

## Change

The Session writer returns to format V4, matching the upstream deepseek-harness release line; the fork-only V5 format is no longer written or read. Logs in the following states do not open in this build:

- A log with a `version: 5` header, written by a fork-period build. The reader rejects it with `session "<id>" uses log format v5, but this harness reads only v4: the log was written by a newer harness — upgrade the harness to open it` and preserves the file unchanged.
- A V4 log containing `anima/extraction-request` or `anima/extraction-result` events, written by an interim build with the Anima plugin enabled. The reader rejects it with `format v4 contains unknown event type "anima/extraction-request" at seq N`; only that session is closed. No feature consumed these audit-only events, so rejection loses no functionality.

Anima's auxiliary model exchanges now persist as ignorable `plugin:anima-memory/extraction-request` and `plugin:anima-memory/extraction-result` records; readers that do not know them retain and skip them. Anima memory data (episodes, reflections, graph) lives in its own directory under the DSH home, outside Session logs, and is unaffected.

## Migration

No conversion is provided: V5 never shipped in a release, and the rejected V4 logs' anima events had no consumer.

1. Keep affected log files where they are; this build never rewrites or deletes them.
2. To recover their content, open the session with the build that wrote it and copy out what you need.
3. Start this build normally; new sessions are written with `version: 4` headers and Anima records go through the `plugin:anima-memory/*` channel. Confirm by reading the first line of a newly written session log.
