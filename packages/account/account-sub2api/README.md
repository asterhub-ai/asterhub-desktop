---
description: "The AsterHub Host account service for Desktop sign-in, Sub2API model-key binding, quota, payment and usage Remote calls."
kind: "package-reference"
---

# @deepseek-ai/dsh-account-sub2api

English | [中文](README.zh.md)

## Summary

Use this Host service to sign in to the configured Sub2API control plane and bind the account's existing model key to this installation. It stores account tokens and profile preferences in Host credentials and the active model key in a dedicated credential record. Its Remote methods return account, quota, payment and usage data without exposing those secrets to the Client.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Failure behavior](#failure-behavior)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Desktop Web profile mounts this service alongside `credentials-local` and the account Client plugin. The Client calls the generated `accountSub2api` Remote namespace; only the Host owns credentials and Sub2API HTTP requests.

### Account model key

A successful login reuses the account's existing group key or creates one only when the account has none. The key is written to the Host record `asterhub-account/model-api-key`, which the Desktop model route reads directly. The legacy `SUB2API_API_KEY` reference is only cleared or migrated from a managed file; environment and `.env` values are not used as the model key. Logout deletes the active key record while retaining per-account records needed to reuse the same upstream key on a later sign-in.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `authBaseUrl` | `https://xapi.fans/api/v1` | Sub2API account control-plane API. Desktop application policy fixes this URL. |
| `groupId` | `6` | Upstream key group used when a key must be created. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-account-sub2api) lists the accepted fields.

### Remote operations

The Host exposes status, login/logout, quota, payment-method, top-up, redemption and usage operations. The Remote responses contain only fields used by account views; access tokens, saved auto-login passwords and model keys stay in Host credentials.

<a id="understand-the-implementation"></a>
## Understand the implementation

The service serializes key provisioning so concurrent logins do not create duplicate group keys. It searches the signed-in account's existing group keys, requests details for masked list entries, and fails rather than rotating a key it cannot read. Account identity gates the local key cache. Credential writes are sequenced so a failed account switch clears a partially written active session instead of pairing one user's token with another user's key.

<a id="further-exploration"></a>
## Further Exploration

- [Credentials](../../credentials/credentials/README.md) — Host references and records.
- [Pi-ai adapter](../../llm/llm-pi-ai/README.md) — model route credential resolution.
- [Client account entry](../../client/ui-settings-account/README.md) — sign-in and account views.

## Known Limitations and Deferred Work

Account operations depend on the configured Sub2API control plane and enabled payment methods.

- Legacy account key references are migrated only from a managed file source; environment-layer values are deliberately ignored.
- Historical duplicate upstream keys are not deleted automatically.

<a id="failure-behavior"></a>
### Failure behavior

Invalid credentials produce an account error. Network, malformed-response, and unavailable-key-detail failures fail without creating a replacement key when the upstream account already has keys. A stale account session clears its active token and key record; a transient quota outage leaves the signed-in account available for retry.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Host integration</summary>

`AccountSub2apiService` consumes `ctx.credentials` and registers the `accountSub2api` namespace. Desktop injects its fixed control-plane URL through application-owned startup policy rather than environment or profile settings.

</details>
