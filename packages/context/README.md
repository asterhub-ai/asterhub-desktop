---
description: "The context group map: workspace guidance, references, local Neo4j memory tools, and other request-context plugins for users and maintainers."
kind: "package-group"
---

# context/ — Request-context plugins

English | [中文](README.zh.md)

## Summary

The context group provides model-visible workspace guidance, file and session references, and request-time facts such as the current time or tmux location. Most packages add context without defining tools; `anima-memory` also captures Session events into a local Neo4j graph and provides project-memory and reflection tools. `agent-instructions` is the only package mounted by `dsh-base`; the web-app bundle mounts `anima-memory`, and the other packages are opt-in. This page maps the group; each package README owns the per-package contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`agent-instructions/`](agent-instructions/README.md) | Loads `AGENTS.md`/`CLAUDE.md` workspace instructions into context and refreshes them after file edits | — |
| [`anima-memory/`](anima-memory/README.md) | Project-scoped local Neo4j memory, Session-event capture, automatic review and reflection, and four native tools | — |
| [`session-reference/`](session-reference/README.md) | References other sessions: mention one and its bounded read-only snapshot becomes context | `ctx.sessionReferenceResolver` |
| [`file-reference/`](file-reference/README.md) | `@file` mention discovery and the shared mention grammar for host-backed UIs | `ctx.fileReferences` |
| [`file-reference-local/`](file-reference-local/README.md) | Local-workspace completion provider for `@file` mentions | — |
| [`time-context/`](time-context/README.md) | Current time, browser zone, and elapsed time per step | — |
| [`tmux-context/`](tmux-context/README.md) | The agent's tmux session, window, and pane location | — |

-----

<a id="related-documentation"></a>
## Related documentation

- [Session-reference subsystem](../../docs/subsystems/session-reference.md) — canonical mention URIs, snapshot semantics, and the stable error taxonomy.
- [Workspace-context decision record](../../.agents/notes/archived/feature/2026-06-24-workspace-context.md) — why instruction context is per-agent/per-session and durably logged.
- [Generated configuration catalog](../../docs/config-catalog.md) — every config field the group's packages accept.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
