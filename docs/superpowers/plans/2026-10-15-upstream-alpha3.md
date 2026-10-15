# AsterHub alpha.3 Follow-up Checklist

English | [中文](2026-10-15-upstream-alpha3.zh.md)

## Goal

Selectively adopt the desktop reliability fixes and useful features released in DSH `0.2.1-alpha.3`, preserving AsterHub accounts, Sub2API routes, signed curated plugins, and the independent Desktop product version.

## Tasks

- [x] Consolidate the validated alpha.2 branch with master and preserve localized payment labels.
- [x] Release Windows update-dialog modality before destroying the window.
- [x] Repair Session restoration and provider teardown; bound Session-list reads.
- [x] Refresh installed plugin code and report required restarts through the curated installation path.
- [x] Adopt bounded terminal duplex input and retain final process output.
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
- Session reliability: focused tests covered preset reuse, Workspace placement, shared list concurrency, and provider teardown. Five JSONL worker cases timed out in the initial concurrent run; all passed with a 30-second test deadline. The real Loader teardown test and Windows persistence-unload replay passed. The existing PowerShell replay passed; POSIX replay and macOS remain unverified. Host and Session-controller type checks passed. Review identified a Workspace attachment race; its negative control failed before the repair and both affected test files passed afterwards. Automated re-review stopped at the Codex usage limit and remains pending.
- Plugin refresh: file comparison and profile recomposition reload changed plugins, including signed curated updates. Restart reasons have localized Settings messages. Focused package and UI tests passed; two file-symlink cases explicitly skip when Windows denies symlink creation. Host and Client type checks and scoped type-aware lint passed. Codex review found no actionable regressions; its test attempt hit Corepack sandbox permissions, while the recorded local test runs completed separately.
- Session re-review completed after usage became available and found no actionable defects. Its test attempt encountered Corepack sandbox permissions; the separate focused test and replay results above remain the validation evidence.
- Terminal duplex: 10 focused test files passed (265 tests, one platform skip). Host build, terminal Client type checks, scoped type-aware lint, and 522 documentation type-equivalence checks passed. Codex review found no actionable issues; its sandbox could not execute the tests. Input frames have raw UTF-8 and encoded-frame bounds, and completed followers retain final output. Desktop interaction remains part of final installer qualification.
