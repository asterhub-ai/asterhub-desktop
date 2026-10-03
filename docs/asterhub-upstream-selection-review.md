# AsterHub selective upstream review

English | [中文](asterhub-upstream-selection-review.zh.md)

This review compares AsterHub’s DSH 0.2.0-rc.2 baseline with upstream 0.2.1-alpha.1. Only the user-selected fixes are backported; the project keeps its baseline version.

## Backported scope

- Office: LibreOffice Kit 0.1.5, preserving unpacked native engine resolution and manifest refresh compatibility.
- Desktop: operating-system-assigned ports and no-response account projection compatibility.
- Plugins: refresh runtime package resolution before installation/enablement and after disablement/removal; retain installation mappings and running modules. Changing a loaded package directory or version still requires restart.
- HMR: invalidate resolution caches after manifest changes while preserving evaluated modules and entry identities. The dependent Loader reload-condition fix and vendoring record are included.

## Model selection fix

Customers select a model and effort from the signed-in key’s /v1/models catalog. Configured models are descriptor templates only. First-load failures are surfaced, and account changes clear cached models. Saving a default still requires the fixed provider and an account-catalog model.

The test account’s existing keys all belong to the AsterHub group (ID 6). Their catalogs return seven real models without aster. No inference request or key creation/modification was performed.

## Separate invariant review

Upstream removes the registry, 38 package src/invariant.ts companions, related exports/tests, and INVARIANT rethrow behavior from four notification producers. These checks inspect internal consistency such as Session logs and Agent state.

The desktop default composition does not mount these plugins; sdk-minimal mounts five rows. Removal does not automatically remove AsterHub’s provider lock, authentication, credential isolation, or sandbox restrictions, but breaks third-party invariant imports and removes diagnostic/test mechanisms.

Keep them this round. A future whole-core upgrade must inspect external plugin imports and replacement test coverage, then coordinate registry, exports, SDK composition, and notification error semantics together.

## Excluded scope

Default Schedule composition, Claude Code Mods, publicUrl, release channels, and build tooling are not backported. Scheduling retains the existing curated-feature direction.

## Validation state

The affected Host/Client TypeScript graph compiles. Regression coverage was added for account catalogs, default selection, and the dropdown; focused results are recorded in the handoff. A Windows file-symlink test fails because the host lacks creation privileges and is not counted as passing. The new portable build and packaged Office smoke checks passed; see the root handoff for the latest ZIP and checksum.
