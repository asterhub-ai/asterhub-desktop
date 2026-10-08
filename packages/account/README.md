---
description: "Host-owned account login, model-key binding, quota, payment and usage access."
kind: "package-group"
---

# account/ — account services

English | [中文](README.zh.md)

## Summary

The account group owns upstream account sessions and account-scoped data used by the Desktop client. Its Host service stores tokens and model keys in Host credentials and returns only account, quota, payment and usage facts needed by the Client.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The account group contains the Host account service used by the Desktop account screens.

| Package | Role |
|---|---|
| [`account-sub2api/`](account-sub2api/README.md) | Signs in to the configured control plane and binds an account's model key to this installation (`ctx.accountSub2api`) |

<a id="related-documentation"></a>
## Related documentation

- [Account subsystem](../../docs/subsystems/account.md) — the Host account Remote and its shared response types.
- [Credentials subsystem](../../docs/subsystems/credentials.md) — the Host credential records used for account tokens and model keys.

<a id="dev-note"></a>
## Dev Note

None.
