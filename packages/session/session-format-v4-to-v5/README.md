---
description: "Preserve supported released V4 Session data as V5 without rewriting history."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

English | [中文](README.zh.md)

## Summary

Restore released V4 Sessions into the V5 writer without altering events, order, inherited cuts, or message data. The adjacent migration preserves the native JSONL rows and validates Anima attribution and records through the installed V5 Session vocabulary. The V5 writer and catalog select this edge on reads; a writable open publishes a versioned successor next to the unchanged source.

## Table of Contents

- [Use this package](#use-this-package)
- [V4-to-V5 conversion](#v4-to-v5-conversion)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Persistence mounts the edge through the build-static Session catalog; consumers do not call it directly.

<a id="v4-to-v5-conversion"></a>
## V4-to-V5 conversion

Only the header format number changes. Dense source event sequence numbers, compact streams, surface references, event payloads, and the inherited prefix count are preserved byte-for-byte at the logical layer. Native V5 admission then checks Anima message attribution and auxiliary event payloads through the installed Session event vocabulary. Read-only access never publishes a successor; writable persistence publishes V5 beside the immutable V4 generation.

<a id="model-experience"></a>
## Model Experience

None, as the migration preserves existing Session history without adding model-facing instructions or messages.

#### KV Cache effect

The existing conversation prefix remains unchanged, so the migration does not affect cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No historical capture reconstruction** — V4-to-V5 conversion preserves only the Session data represented in V4. It does not synthesize Anima capture or graph records from earlier conversation text.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
