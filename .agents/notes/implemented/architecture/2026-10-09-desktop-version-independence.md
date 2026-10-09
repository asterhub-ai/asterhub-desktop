# Agent Note: Keep AsterHub Desktop and DSH versions independent

Status: implemented

English | [中文](2026-10-09-desktop-version-independence.zh.md)

## Problem

AsterHub Desktop can release independently from the shared DSH runtime. Requiring its product version to equal the DSH package version prevents Desktop update releases when the runtime package has not changed.

## Decision

`apps/desktop/package.json` owns the installed Desktop product version and the version compared by `electron-updater`. The repository root `package.json` owns the bundled DSH runtime version. These versions are independent; the current Desktop product version is `0.21.0` while the bundled DSH runtime remains at its own package version.

The Electron manifest, installer names, update feed metadata, packaging completion record, and upload validation use the Desktop product version or its confirmed test-build derivative. The runtime descriptor, development project, and `desktop-host` package set use the root DSH version. `verifyDesktopRuntime` validates that runtime version, and the mandatory update policy receives it separately from the installed Desktop version.

Production releases use the exact Desktop manifest version. Test versions derive from that Desktop base: prerelease versions append `.YYYYMMDD.index`, and stable versions append `-test.YYYYMMDD.index`. Operators check retained records and the selected destination before assigning an index. The [build-version input decision](../process/2026-09-21-desktop-build-version-as-input.md) keeps test versions out of tracked manifests. The former DSH-owned base decision is preserved as [historical policy](../../archived/process/2026-09-16-desktop-release-version-derivation.md).

## Alternatives considered

**Use the root DSH version as the Desktop product version.** Rejected because it couples AsterHub update delivery to an independently released runtime package and can block an application update that requires no DSH package change.

**Rewrite DSH package versions for every Desktop release.** Rejected because those manifests identify a separate runtime release family; rewriting them would misstate package versions and recreate broad lockfile churn.

## Consequences

Desktop update ordering follows the Desktop product version. Runtime compatibility remains checked against the DSH version declared by the bundled runtime and its shared packages. Packaging and upload code must validate each version against its owner rather than compare the two values.

Test builds preserve the Desktop product version in manifests and use the explicit `--build-version` for artifact names and update metadata. A feed replacement cannot downgrade an installed client; a corrected lower version requires manual installation.

## Verification

`desktop-upload-plan.spec.ts` covers an artifact whose Desktop version is `0.21.0` while its DSH runtime version is `0.2.0-rc.3`. `package-target-stages.spec.ts` verifies the completion record uses the Desktop version. `packaged-runtime-verification.spec.ts` verifies the bundled runtime is checked against the root DSH version.
