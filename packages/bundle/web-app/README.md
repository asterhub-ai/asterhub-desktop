---
description: "The browser GUI for dsh: interactive chat, model and settings management, and session history, for users running the dsh web surface."
kind: "package-bundle"
---

# @deepseek-ai/dsh-web-app

English | [中文](README.zh.md)

The AsterHub product-Web layer mounts Desktop analytics only when `DSH_PRODUCT_ANALYTICS_OTLP_URL` is explicitly configured. It is composed after this generic Web surface by the shipped Web and Desktop profiles.

Desktop analytics batches partial records every 30 seconds, with 15-second exporter and 20-second processor timeouts. Shutdown allows 2 seconds to drain before cancelling pending requests; pending events may be lost.

## Summary

The shipped Web and Desktop profiles layer in AsterHub's [local Anima memory](../../context/anima-memory/README.md), account, voice input, and project-local session storage. The product layer also registers four presets: `standard` (default), `ptc`, `minimal`, and `cordis`. These product services are not part of this generic browser-surface bundle.

The Host mounts the subagent model-selection settings provider required by the shipped presets. Model selection remains disabled until enabled with an allowed route list.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Start the GUI, open your browser, and start talking to the agent. The flags fine-tune the invocation.

### Starting the Web GUI

```sh
dsh --profile web
dsh --profile web --no-open --port 8080
```

After startup you see a `dsh web:` line whose root URL carries a fresh process token. Unless `--no-open` or an SSH session suppresses it, the default browser opens that URL, receives a signed cookie, and redirects to the same directory without the token. You know it worked when the page loads and you can chat with the agent. Two failures to expect: if the frontend is not built, startup stops with a build hint (`pnpm run build` in a checkout); if the browser cannot be opened, a credential-free diagnostic prints to stderr while the server keeps running — open the printed startup URL yourself.

The shipped AsterHub product-Web layer supplies the authenticated account route and its model catalog in **Settings → Models**. Provider and endpoint configuration stays deployment-locked; users select only models available from their account.

### Configuration

Most users never set these; the command-line flags feed the four settings below — `--host`, `--port`, and `--trusted-host` come from the invocation, and `--no-open` turns the browser handoff off for that invocation:

| Field | Default | Meaning |
|---|---|---|
| `openBrowser` | `true` | Open the default browser after startup; SSH launches suppress it |
| `printUrl` | `true` | Print the `dsh web:` URL line at startup |
| `surfaceContext` | `true` | Give the agent GUI-orientation context and expose `DSH_WEB_URL` to its shell commands |
| `trustedHosts` | `[]` | Extra hosts allowed to reach the GUI from the network |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-app) is the exhaustive source for every accepted field and its JSDoc. The shipped composition carries no `time-context`, `schedule`, or `ui-schedule` row; the optional experimental bundle `@deepseek-ai/dsh-experimental-schedule-bundle` inserts those three rows from the Plugins page.

### LAN access and trusted hosts

By default the GUI accepts connections from this machine only. A deployment that binds all network interfaces also allows browsers from the LAN, and the printed URL then includes a LAN address; `--trusted-host` adds extra hosts in either case. Host and Origin checks control reachability, while the token exchange authenticates every Host API method and WebSocket stream. The LAN addresses are sampled once at startup, so a network change later is not picked up — restart the GUI to re-advertise.

### Running over SSH

When you launch `dsh --profile web` over SSH, the URL line still prints but the browser is not opened for you: the SSH client or editor owns the local forwarding address. Open the forwarded URL on your machine yourself; the printed URL names the remote host's loopback endpoint.

### Per-session agent setup

Each browser session selects a shipped preset (`standard` by default). The Agent presets settings page changes the default and edits preset child plugins; saves persist in `$DSH_HOME/profiles/web/cordis.patch.yml`. Creator's plugin-management tool is enabled only when the Host provides an editable profile.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This generic Web bundle carries the browser host rows, transport, and browser roster plus the runtime glue plugin. The AsterHub product-Web bundle owns the shipped preset registry and preset declarations, as well as product-only account, storage, memory, voice, and analytics defaults. The storage stack and projection cache come from `dsh-base`; the Web overlay's workspace and message-feedback rows consume that shared `storageDomain` service. The glue plugin owns dist serving, trust sampling, prompt sections, the bash variable, and readiness announcements. The `office-to-pdf` row mounts one lazy [Office conversion provider](../../document/office-to-pdf/README.md) for Host consumers, including Desktop compositions using this bundle. The conversion service's Remote methods authorize preview reads, while Document Preview owns the Office viewer and Client cache.

### Patch semantics

Patch rows replace the targeted row's whole `config`. This layer owns Web invocation settings and the `session-query-sqlite` override; product personas, preset composition, and private services are supplied by later product layers. The Web surface inserts host rows, transport, and browser roster, then moves the agent plane behind product-owned presets.

### Readiness

The URL line and browser handoff are readiness signals: supervisors RPC as soon as they observe the line, and a browser requests the page as soon as it opens, so both run only after the Loader tree settles, the required-startup audit passes, and Connection authentication is available — or immediately in a hand-built tree without a Loader. Client combo JavaScript and source maps remain unmaterialized at this point. Optional plugin failures do not suppress readiness; a required startup failure or a tree disposed mid-boot announces nothing.

### LAN trust sampling

`resolveLanTrust` samples the network once at boot: a loopback bind (`127.0.0.1`) derives no LAN addresses, while an all-interfaces bind adds every non-internal IPv4 literal. The derived literals plus the explicit `--trusted-host` authorities form the `/api` browser-trust fence, and the printed LAN URL always matches that fence.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `web-app` glue plugin: dist resolution, LAN trust sampling, prompt sections, bash variable, URL line, browser handoff |
| [`src/startup.ts`](src/startup.ts) | The `web-startup` provider: `--host`, `--port`, `--trusted-host`, `--no-open`, `--help` |
| [`cordis.patch.yml`](cordis.patch.yml) | Generic Web host rows, browser roster, and surface values |
| — | Shipped AsterHub presets and the product registry are in [`asterhub-product-web`](../asterhub-product-web/README.md) |
| — | No runtime invariant companion is published; every contribution (frontend-static child plugin, prompt section, bashEnv registration) is registry-disposed with the fiber, and each owning registry's package carries that relation's invariant; the package holds no mutable state of its own to audit. |
| [`tests/web-app.spec.ts`](tests/web-app.spec.ts) | Dist resolution, fallback seat, prompt sections, readiness |
| [`tests/startup.spec.ts`](tests/startup.spec.ts) | Command-line parsing over a real Loader tree |
| [`tests/trusted-hosts.spec.ts`](tests/trusted-hosts.spec.ts) | LAN-trust sampling |
| [`tests/browser-open.spec.ts`](tests/browser-open.spec.ts) | Default-browser handoff after the page is reachable |

### Invariant ownership

No invariant companion is published because every contribution — the frontend-static child plugin, the prompt sections, and the bash variable registration — is registry-disposed with the fiber, and each owning registry package carries that relation's invariant.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into the shared core, the browser reload pipeline, or the built frontend.

- [Bundle package map](../README.md) — the surfaces built on the same core.
- [dsh-base](../base/README.md) — the shared core the GUI runs on.
- [dsh-client-hmr](../../client/hmr/README.md) — how client-plugin changes reload during development.
- [frontend-static](../../host/frontend-static/README.md) — how the built frontend is served.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-app) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### Source and desktop-app context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk AsterHub implementation without claiming it is the working directory, and the `app:web-surface` section orients the model to the AsterHub desktop app. It does not expose a browser URL or development-server instructions. The separate `DSH_WEB_URL` variable remains available to managed bash for development sessions and is resolved from the live server. When `surfaceContext` is false, neither section nor the variable is registered.

#### Token effect

One source line and one prompt paragraph per session plus two managed-environment variable lines; constant per process.

#### KV Cache effect

Source and desktop-app sections follow first-party reusable instructions. Different checkout paths leave that preceding prefix unchanged when tools and configuration match; provider cache reuse is not guaranteed.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits tell you what to expect in unusual setups — a source checkout, SSH sessions, or strict networks. They are current package constraints, not a general browser comparison or a task backlog.

- **The frontend must be built** — a source checkout needs `pnpm run build` first; startup stops with a build hint when the dist is missing, and there is no source-serving fallback.
- **LAN addresses are sampled once at startup** — interface changes after boot are not re-advertised; the printed LAN URL always matches what was sampled.
- **Only the handoff start is observable** — the GUI reports that the browser was asked to open, not that it actually opened; a later browser exit is never reported, and the printed URL is your manual fallback.
- **SSH sessions keep the URL but skip the browser handoff** — the printed URL names the remote host's loopback endpoint; the SSH client or editor must expose and open the local forwarded address.
- **`BROWSER` overrides only come from the environment** — a discovered `.env` cannot set `BROWSER`; only an inherited value can choose the executable for the automatic handoff.
- **Binding all network interfaces is not supported** — `--host 0.0.0.0` is rejected at startup for safety; use the default loopback host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

The shipped Web and Desktop profiles compose the separate `@deepseek-ai/dsh-asterhub-product-web` bundle after this generic Web layer; account, Anima, project-local storage, speech, model selection, and product analytics defaults are owned there.
