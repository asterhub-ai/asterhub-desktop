# AsterHub upstream update record

English | [中文](asterhub-upstream-upgrade.zh.md)

This checkout selectively incorporates [DSH 0.2.1-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2) on `codex/upstream-alpha2`. The desktop product remains `0.21.0`; workspace packages remain `0.2.0-rc.3`.

## Implemented changes

| Group | Result |
| --- | --- |
| Existing desktop baseline | The first installer page displays its installation folder. Desktop credentials use Electron OS encryption; encrypted mode rejects plaintext without migration. |
| Desktop dependencies | Electron 44.7.0, native builtin loader 0.1.9, electron-builder and app-builder-lib 26.17.0; canonical drive roots are rejected before directory ownership checks. |
| Plan review | Dismissal returns `approved: false`, ends the turn and preserves plan mode; only approval exits it. |
| SenseVoice | First-segment onset padding defaults to 0.3 seconds, accepts 0–1 seconds and leaves later segments unchanged. |
| pi-ai | Version 1.0.2, catalog-gated conversation updates, replayed tool namespaces and the final-only tool-argument JSON parsing patch. |

AsterHub retains its account-owned Sub2API credentials and model catalog, project attachment scope, branding and signed curated-plugin catalog. This update adds no CLI product mode, experimental Worktrees, old-version migration or public release.

## Verification

| Evidence | Observed result |
| --- | --- |
| Host and Client project graphs | `node node_modules/typescript/bin/tsc -b tsconfig.host.json tsconfig.client.json` passed. |
| Desktop, ASAR, Host and HMR tests | Focused serial run: 203 passed, 3 platform cases skipped. |
| Windows packaged runtime | Official x64 packaging and ASAR Host smoke passed, including DOCX/XLSX/PPTX conversion, workspace inspection and Session creation. |
| Native Windows installer UI | Production NSIS fixture passed 15 cases in each locale, including welcome, path validation, install, launch and uninstall. |
| Built Windows installer | The unsigned `0.21.0` installer installed into an isolated temporary directory; `AsterHub.exe` and its uninstaller were present, and silent uninstall succeeded. |
| Plan mode | 88 package tests passed; the four integration tests also passed after adding the next-message assertion. |
| SenseVoice | 35 inference/Worker tests passed in isolation; two additional out-of-range configuration cases passed. The earlier broad run had two timing failures. |
| pi-ai and account integration | 413 tests passed. The HTTP fixture supports the zstd requests emitted by pi-ai. |
| OS credential encryption | A real Electron process wrote an encrypted account grant; a second process decrypted it successfully. |
| Local updater | 17 real Electron 44.7.0 scenarios passed using loopback services and inert payloads. No installer was executed; screenshot capture failed and does not count as visual acceptance. |
| Official local review | `codex review --uncommitted` started but was interrupted by the account usage limit. No review conclusion was produced. |

The Sub2API service `auth/login`, `auth/refresh`, `/auth/me`, and account-bound model listing all succeeded. The product adapter then reused an existing model key. Through the upgraded product adapter, GPT-6-Luna returned text, issued the requested tool call with the expected marker, and completed its follow-up; cancellation stopped the request and a deliberately invalid test key was rejected. GPT-6-Luna emitted no reasoning block, so a reasoning-bearing model and switching between two real accounts remain unverified. No account key was created or rotated.

The first broad desktop/runtime test selection was not green: it included Windows file-symlink permission failures, an outdated persona assertion and resolution-matrix failures. Its remaining worker was terminated after sustained execution; the subsequent focused desktop/HMR run above passed. These are separate results.

The Windows `ptc-turn` recorded-session replay starts successfully but differs because Windows automatically contributes the sandbox ACL diagnostic skill. Its stored-session comparison failed; the cross-platform Session fixtures were not replaced with Windows-only output. Existing tool-schema sidecars now use boolean `approved`.

Repository-wide constraints report existing private-package release metadata, workspace-range and default experimental-speech dependency violations. Dependency classification also rejects the existing file-upload import of `resolveProjectAttachmentScope`. Documentation quick checks completed with 10 gates passing and 11 failing, including existing onboarding links and account type-equivalence manifest omissions. The documentation website and documentation typecheck passed; `doc-sync` stopped at three existing automation events without `@mode` tags. Full lint reported 559 diagnostics; staged lint passed. These repository-wide checks are not recorded as passing.

## Artifact and remaining qualification

The official Windows x64 unsigned package completed after the first attempt timed out on npm downloads. The successful run used the npm mirror only for that process. The installer is `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/asterhub-0.21.0-win-x64-unsigned.exe` (440,041,976 bytes; SHA-256 `19ACDEA8397D10E90C6E1F164315965D0D2ABBB0FF5946A75A8CD37F2B4AAF0C`). Packaging and updater logs are under `apps/desktop/.desktop-build/`; no files were signed or uploaded.

GPT-6-Luna returned streamed text; its server did not emit reasoning blocks. Real reasoning output from DeepSeek V4 and a product-side transition between two accounts remain unverified. Speech-model files were reused from the local package only after verifying all three current SHA-256 pins; transcription of a Chinese WAV sample was skipped at your request. macOS installation and native runtime qualification remain pending.
