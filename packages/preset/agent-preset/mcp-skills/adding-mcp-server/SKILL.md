---
name: adding-mcp-server
description: Use when a user asks to add, inspect, disable, enable, or remove an MCP server through a Standard, PTC, or Creator conversation.
---

# Add an MCP server through a profile bundle

The profile's MCP tools come from `@deepseek-ai/dsh-mcp-client` rows inside an installed DSH bundle. Use the existing `plugin_manager` conversation tool for bundle install and lifecycle; do not edit the Desktop profile patch directly or route an MCP through the app's curated plugin catalogue.

## Add

1. Identify the MCP transport and source the user asked for. stdio needs an executable and argument vector; Streamable HTTP needs an HTTPS endpoint. Ask for a server name if none is supplied, and keep it unique within the profile.
2. Never ask the user to paste API keys, bearer tokens, passwords, or private headers into chat or a bundle file. For a server requiring credentials, use only an environment variable already configured for the Host and reference it in `!!js` configuration. If no safe credential source exists, explain that prerequisite and do not embed a secret.
3. Create an ordinary package directory in the user's current workspace with a `package.json` declaring a DSH bundle patch and a dependency on the matching `@deepseek-ai/dsh-mcp-client` version. Put one uniquely identified client row in `cordis.patch.yml`.
4. Install the absolute package-directory path with `plugin_manager` `install_bundle`. The tool's Host approval still applies; if pnpm reports pending build scripts, obtain explicit approval before retrying with `approvedBuilds`.
5. Verify `application: applied`, list the profile bundles, and confirm the `mcp__<serverName>__*` tools appear. Do not report success from a saved dependency alone; `restart-required` means the current Host has not activated it.

Example package:

```json
{
  "name": "@local/example-mcp-config",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": { "@deepseek-ai/dsh-mcp-client": "0.1.6-alpha.2" }
}
```

stdio row:

```yaml
- insert:
    - id: mcp-example
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: example
        command: npx
        args: ['-y', '@example/mcp-server']
        env: {}
```

Streamable HTTP row:

```yaml
- insert:
    - id: mcp-example
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: example
        url: https://mcp.example.com/mcp
        headers: {}
```

## Lifecycle

Use `plugin_manager` `list_bundles` to identify the owning bundle, then `set_bundle` to enable or disable it and `remove_bundle` to uninstall it. These operations persist for the profile and retain the manager's per-call Host approval. Other conversation requests can install arbitrary sources independently of the curated Plugins page.
