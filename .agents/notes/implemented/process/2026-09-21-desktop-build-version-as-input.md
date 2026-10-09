# Agent Note: Pass the Desktop build version as an argument instead of rewriting manifests

Status: implemented

English | [中文](2026-09-21-desktop-build-version-as-input.zh.md)

## Problem

The [independent Desktop version decision](../architecture/2026-10-09-desktop-version-independence.md) assigns product releases to the Desktop manifest and runtime releases to the root DSH manifest. This note records the earlier build-input problem: test publishing once rewrote 295 release-family manifests and the lockfile, and operators chose the `<base>.YYYYMMDD.index` by hand.

Two more facts about a build were unrecoverable afterwards. A build handed to a colleague or pushed to a test feed is reachable from no tag, and the build tree it came from is not a checkout, so nothing connected an installer to its sources. A production release was likewise recorded only in the bucket.

## Decision

The version a build publishes is an argument. `--build-version` names it, `--build-version auto` proposes the next index for the day, and the value reaches electron-builder through `extraMetadata`, the update feed, and the upload validation as one input. Manifests keep the product version, so no packaging run modifies tracked files.

The version rules in the [Desktop release rules](../../../../apps/desktop/README.md#release-versions) use the Desktop product base: production publishes it exactly, prerelease tests append `.YYYYMMDD.index`, and stable tests append `-test.YYYYMMDD.index`. Validation uses `semver` because `electron-updater` compares feed versions with `semver.gt` against installed `app.getVersion()`.

Desktop product and bundled DSH runtime versions are independent. `app.getVersion()` and update feeds use the Desktop build version; the runtime descriptor and `verifyDesktopRuntime` use the root DSH version. Installed-update qualification rewrites a private runtime descriptor only for its isolated materials.

Every artifact records `dshBuildCommit` and `dshBuildDirty` in its manifest. A production upload tags the packaged commit as `desktop-v<version>` after the artifacts are public, and reports the command to run by hand rather than failing an upload that already completed; a build from a modified checkout is not tagged. Test and local builds are deliberately left untagged, because a tag per test build would bury the releases.

Upload reads the published version from the completion record packaging wrote, not from a variable, so [release fields still come only from the target file](../../../../apps/desktop/README.md#release-versions).

## Alternatives considered

**Keep rewriting manifests and revert afterwards.** The dirty tree is the defect, and a revert races anything else reading the workspace. It also leaves the published artifacts describing a state the repository no longer has.

**Rewrite only the packed runtime's manifest in a temporary copy.** The bundled dsh would then claim a version that does not exist on npm, and the copy would have to be kept consistent with the lockfile for no gain.

**Number every build automatically without an argument.** Operators confirm the version with the user before packaging. Automatic numbering is offered as `auto`, which prints what it chose, rather than as the default.

**Tag every build.** Test feeds receive builds continuously; tagging each one would make `desktop-v*` useless for finding releases. Artifacts carry their commit instead.

## Consequences

A packaging run leaves the repository unchanged, so the tree that built an artifact is the tree the tag or the recorded commit names. `auto` contacts the destination bucket, including under `--check`, and falls back to the local output directory when no bucket is configured or the listing cannot complete within its deadline; a partial listing is discarded rather than risking a reused index that would overwrite a published installer. Uploading a production release now writes to the repository, which earlier release automation deliberately avoided; the write is one tag, performed by the operator's own command after the upload succeeds.
