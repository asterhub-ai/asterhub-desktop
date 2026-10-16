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
- [x] Repair conversation row ordering, scrolling, and work-details folding.
- [x] Adapt pi-ai 1.1.0 and preserve original protocol history through conversions.
- [x] Mask recognized credentials in displayed user messages, with explicit reveal controls.
- [x] Add Desktop shortcuts that adjust interface, code, and terminal font sizes together.
- [x] Adopt progressive Office guidance and synchronize bundled resources and smokes.
- [ ] Run focused regressions, Session snapshots, type checks, build, dependency, lint, and documentation checks.
- [ ] Review each implementation group locally and resolve confirmed findings.
- [x] Build the Windows unsigned test installer; record remaining qualification as pending.

## Constraints

Do not introduce CLI product modes, Worktrees, remote sharing, independent provider catalogs, or the canceled assistant-team feature. Do not publish artifacts, change the product version, add old-version migration behavior, or upload signing credentials. Actual voice recording remains user-owned testing.

## Verification record

Implementation and validation results are recorded here as each task completes. A missing environment or credential is an unverified item, not a pass.

- Baseline and Windows dialog: 16 focused tests passed and one platform case skipped. Local Codex review found no actionable defects; its separate test attempt hit a Corepack cache permission error. The recorded focused run above completed outside that review sandbox.
- Session reliability: focused tests covered preset reuse, Workspace placement, shared list concurrency, and provider teardown. Five JSONL worker cases timed out in the initial concurrent run; all passed with a 30-second test deadline. The real Loader teardown test and Windows persistence-unload replay passed. The existing PowerShell replay passed; POSIX replay and macOS remain unverified. Host and Session-controller type checks passed. Review identified a Workspace attachment race; its negative control failed before the repair and both affected test files passed afterwards. Automated re-review stopped at the Codex usage limit and remains pending.
- Plugin refresh: file comparison and profile recomposition reload changed plugins, including signed curated updates. Restart reasons have localized Settings messages. Focused package and UI tests passed; two file-symlink cases explicitly skip when Windows denies symlink creation. Host and Client type checks and scoped type-aware lint passed. Codex review found no actionable regressions; its test attempt hit Corepack sandbox permissions, while the recorded local test runs completed separately.
- Session re-review completed after usage became available and found no actionable defects. Its test attempt encountered Corepack sandbox permissions; the separate focused test and replay results above remain the validation evidence.
- Terminal duplex: 10 focused test files passed (265 tests, one platform skip). Host build, terminal Client type checks, scoped type-aware lint, and 522 documentation type-equivalence checks passed. Codex review found no actionable issues; its sandbox could not execute the tests. Input frames have raw UTF-8 and encoded-frame bounds, and completed followers retain final output. Desktop interaction remains part of final installer qualification.
- Conversation layout: Client type checks and scoped lint passed. Package regression failures were repaired and rechecked; the final layout run passed 280 tests. Review found missing question-reply input positions and selectors that missed the flow wrapper. Both were repaired; the reply negative control failed before repair and 87 related tests passed afterwards. The reasoning body now renders through a replaceable Slot/Factory pair and omits blank blocks; 112 related tests passed after that port. Final Codex review found no actionable defects. Real-browser geometry and installer interaction remain pending.
- pi-ai: pinned 1.1.0 and retained the incremental argument patch. Protocol conversion preserves native history; nine cross-protocol round trips passed. Adapter, catalog, stream, serialization, runtime-patch and Windows PTY tests passed after fixture and brand-assertion repairs. Package types, scoped lint, and the authored PowerShell empty-text-history replay passed; POSIX replay remains unverified. Desktop preparation now stages and verifies the selected pi-ai and node-pty patches. Review requested a legacy Azure upgrade guide; the explicit development-only task excludes such guides, so current configuration documentation was updated instead. Final packaged-runtime and live Sub2API qualification remain pending.
- Fonts: role-specific settings, DOM projection, terminal refitting, and combined shortcuts are implemented. Focused package types and lint passed; the behavior recheck passed 59 tests without unhandled errors. The frozen offline lockfile check passed after adding the shortcuts edge. Final review found no actionable regressions. The broad theme test selection also exposed repository-wide style-audit failures in existing AsterHub automation/account surfaces and stale removed-account paths; those audits remain failed, separate from the passing font behavior tests. Browser and native keyboard qualification remain pending.
- Credential masking: user-text references now pass through a renderer pipeline that masks recognized credentials and exposes a per-value reveal control; session content and copy actions retain the original text. The focused secret renderer run passed 117 tests and the broader user-text/UI run passed 238 tests. Browser e2e reached the browser launch but could not run because the Playwright Chromium binary is absent; installing it stalled at 0% and was stopped.
- Progressive Office: the bundled catalog now has a router, three authoring skills, and separate rendering, recalculation, and PDF-export skills. The Desktop Host smoke now checks all seven entries and the operation runtime paths; the refreshed recorded Office sessions replay on Windows. Office and primary-runtime tests passed 32 cases. The snapshot fixture uses a local command wrapper instead of file symlinks, and its Office process deadline accounts for Windows startup time. A later unsigned packaging run completed runtime preparation, integrity checks, and installer creation; smoke checks were skipped at the user's request. Actual installation, launch, packaged Host/ASAR behavior, and live Sub2API behavior remain unverified. Voice recording was skipped at the user's request; macOS qualification remains pending.
- Aggregate checks: Host build and full Client typecheck passed; `pnpm run build` produced the official Web and Client artifacts. The affected package type-aware lint passed. `test:docs` passed 20 of 21 gates; its only failure is the pre-existing hard-wrapped paragraph warning in `packages/client/file-upload/README.md` and `.zh.md`. `doc-sync` passed 40 of 43 gates before stale generated catalogs were refreshed; the generated graph, catalog, JSDoc, package-list, and persistence checks now pass individually. Full hygiene still reports existing package-constraint, product-isolation, and vendoring-rescope violations outside the changed files. Codex `/review` could not be launched from this session because the available review connector only exposes pull-request check diagnostics; group reviews remain pending.
- Review repairs: Desktop Office smoke reads runtime JSON from the loaded operation skill. The credential-mask browser fixture registers project storage and isolates the account sign-in gate; its app-local ARIA golden was generated from Chromium and replayed successfully. Office and Desktop focused tests passed 12 cases; Web test types and scoped lint passed. Read-only inspection of these repairs found no further actionable issues. The unsigned installer was created successfully with smoke checks skipped by request; actual installation and launch remain unverified. Voice self-testing and macOS qualification remain pending.
