---
description: "The Account settings entry of the AsterHub web client, providing sign-in, account quota, payment, usage and logout controls."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-account

English | [中文](README.zh.md)

## Summary

Use this Client plugin to show the account section and its usage view inside Settings, plus the logged-out sign-in gate. It calls the Host `accountSub2api` Remote through narrow injected actions and never receives an account token or model key. Desktop's native application menu can open the account view or request logout through the same Host service.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Desktop Web composition mounts this plugin with the generated `api-remotes`, locale, Settings and sidebar Client modules. Its `dsh.client.inject` declares the Remote namespace before the account components register.

### Account surfaces

The Account section offers login, logout, balance, payment-method, top-up and redemption controls. The separate usage view presents aggregated request, token and credit counts by total, last seven days and today. Token statistics show grouped exact counts below 1M, use M from 1M, and switch to B at 1B; compact values are rounded for display while accounting remains exact. The sign-in gate uses Host status and opens the account view when a user initiates a protected action while logged out.

### Desktop menu

The Desktop shell sends open-account and logout commands to the Client. The plugin translates them into the same account Remote calls and refreshes Host state; it does not read or store model credentials in browser storage.

## Further Exploration

- [Account Host service](../../account/account-sub2api/README.md) — credential and Sub2API lifecycle.
- [Settings shell](../ui-settings/README.md) — Settings section registration.
- [Remote assembly](../../api/remotes/README.md) — generated Host namespaces in the Web client.

## Known Limitations and Deferred Work

The Client displays Host responses; it does not act as an independent account authority.

- Payment controls are unavailable when the Host reports no enabled payment methods.
- The usage view requires the Sub2API account to expose its aggregate statistics endpoints.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Client integration</summary>

The package declares both `remote` and `remote.accountSub2api`; account callbacks are narrowed before they cross the shared Settings and overlay slots.

</details>
