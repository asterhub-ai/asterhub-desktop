# AsterHub alpha.3 Follow-up Checklist

English | [中文](2026-10-15-upstream-alpha3.zh.md)

## Goal

Selectively adopt the desktop reliability fixes and useful features released in DSH `0.2.1-alpha.3`, preserving AsterHub accounts, Sub2API routes, signed curated plugins, and the independent Desktop product version.

## Tasks

- [x] Consolidate the validated alpha.2 branch with master and preserve localized payment labels.
- [x] Release Windows update-dialog modality before destroying the window.
- [ ] Repair Session restoration and provider teardown; bound Session-list reads.
- [ ] Refresh installed plugin code and report required restarts through the curated installation path.
- [ ] Adopt bounded terminal duplex input and retain final process output.
- [ ] Repair conversation row ordering, scrolling, and work-details folding.
- [ ] Adapt pi-ai 1.1.0 and preserve original protocol history through conversions.
- [ ] Mask recognized credentials in displayed user messages, with explicit reveal controls.
- [ ] Add Desktop shortcuts that adjust interface, code, and terminal font sizes together.
- [ ] Adopt progressive Office guidance and synchronize bundled resources and smokes.
- [ ] Run focused regressions, Session snapshots, type checks, build, dependency, lint, and documentation checks.
- [ ] Review each implementation group locally and resolve confirmed findings.
- [ ] Build and qualify the Windows unsigned test installer; record macOS checks as pending.

## Constraints

Do not introduce CLI product modes, Worktrees, remote sharing, independent provider catalogs, or the canceled assistant-team feature. Do not publish artifacts, change the product version, add old-version migration behavior, or upload signing credentials. Actual voice recording remains user-owned testing.

## Verification record

Implementation and validation results are recorded here as each task completes. A missing environment or credential is an unverified item, not a pass.

- Baseline and Windows dialog: 16 focused tests passed and one platform case skipped. Local Codex review found no actionable defects; its separate test attempt hit a Corepack cache permission error. The recorded focused run above completed outside that review sandbox.
