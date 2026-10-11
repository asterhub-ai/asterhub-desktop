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
| Native Windows installer | Both locales passed 15 cases each, including the visible folder, path validation, installation, launch and uninstall. |
| Plan mode | 88 package tests passed; the four integration tests also passed after adding the next-message assertion. |
| SenseVoice | 35 inference/Worker tests passed in isolation; two additional out-of-range configuration cases passed. The earlier broad run had two timing failures. |
| pi-ai and account integration | 413 tests passed. The HTTP fixture supports the zstd requests emitted by pi-ai. |
| OS credential encryption | A real Electron process wrote an encrypted account grant; a second process decrypted it successfully. |
| Local updater | 17 real Electron 44.7.0 scenarios passed using loopback services and inert payloads. No installer was executed; screenshot capture failed and does not count as visual acceptance. |
| Official local review | `codex review --uncommitted` started but was interrupted by the account usage limit. No review conclusion was produced. |

The first broad desktop/runtime test selection was not green: it included Windows file-symlink permission failures, an outdated persona assertion and resolution-matrix failures. Its remaining worker was terminated after sustained execution; the subsequent focused desktop/HMR run above passed. These are separate results.

The Windows `ptc-turn` recorded-session replay starts successfully but differs because Windows automatically contributes the sandbox ACL diagnostic skill. Its stored-session comparison failed; the cross-platform Session fixtures were not replaced with Windows-only output. Existing tool-schema sidecars now use boolean `approved`.

Repository-wide constraints report existing private-package release metadata, workspace-range and default experimental-speech dependency violations. Dependency classification also rejects the existing file-upload import of `resolveProjectAttachmentScope`. Documentation quick checks completed with 10 gates passing and 11 failing, including existing onboarding links and account type-equivalence manifest omissions. The documentation website and documentation typecheck passed; `doc-sync` stopped at three existing automation events without `@mode` tags. Full lint reported 559 diagnostics; staged lint passed. These repository-wide checks are not recorded as passing.

## Artifact and remaining qualification

The first unsigned Windows `0.21.0` packaging attempt passed the builds but failed while downloading production dependencies from npm due to timeouts. Packaging is being retried through the official package script with the existing npm-mirror configuration scoped to this process. Packaging and updater results are recorded under `apps/desktop/.desktop-build/`; no files are uploaded.

Real Sub2API inference requires an available test account, and real speech recognition requires a Chinese WAV sample and prepared models. Neither has been qualified in this session. macOS installation and native runtime qualification remain pending.
