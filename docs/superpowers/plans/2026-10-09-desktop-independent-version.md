# Independent Desktop Version Implementation Plan

> **For agentic workers:** Use the TDD workflow task by task; verify each step before continuing.

**Goal:** Publish AsterHub Desktop as version `0.21.0` while the bundled DSH runtime remains at its own package version.

**Architecture:** Electron's product version and update feed version come from `apps/desktop/package.json`. The embedded `@deepseek-ai/dsh` runtime descriptor, package set, and development project continue to use the repository root DSH version. Packaging and upload validation must compare each value with its own owner rather than requiring equality.

**Tech Stack:** TypeScript, Electron Builder, Vitest, pnpm.

**Spec:** User decision in this conversation: Desktop release versions are independent of DSH; the current complete version is `0.21.0`.

## Global Constraints

- Keep the root DSH package version unchanged.
- Set the Desktop product manifest to `0.21.0`.
- Keep the bundled DSH and desktop-host package set internally version-aligned.
- Do not upload until local signing/update configuration is valid and the user confirms the exact test-build version.
- Do not include credentials in source, tests, or output.

---

### Task 1: Pin the independent version behavior in tests

**Files:**
- Modify: `apps/desktop/tests/desktop-upload-plan.spec.ts`
- Modify: `apps/desktop/tests/package-target-stages.spec.ts`
- Modify: `apps/desktop/tests/packaged-runtime-verification.spec.ts`
- Modify: `apps/desktop/package.json`

- [ ] Change the upload-plan fixture to use Desktop `0.21.0`, DSH `0.2.0-rc.3`, and an artifact completion record for `0.21.0`; assert that planning accepts the independently versioned Desktop artifact.
- [ ] Change the runtime-verification test to expect the root DSH package version, not the Desktop package version.
- [ ] Set `apps/desktop/package.json` to `0.21.0` and run both focused tests; confirm the existing coupling makes them fail.

### Task 2: Separate product and runtime version sources

**Files:**
- Modify: `apps/desktop/scripts/package-target.ts`
- Modify: `apps/desktop/scripts/desktop-upload-plan.ts`
- Modify: `apps/desktop/scripts/prepare-dsh.ts`
- Modify: `apps/desktop/scripts/dev.ts`
- Modify: `apps/desktop/scripts/electron-builder-config.mjs`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/release.ts`

- [ ] Remove checks that require the Desktop manifest version to equal the root DSH version.
- [ ] Resolve artifact, release-record, and upload versions from the Desktop product manifest.
- [ ] Resolve runtime release metadata and embedded shared-package versions from the root DSH manifest.
- [ ] Preserve build-version validation against the Desktop product version and runtime integrity validation against the DSH runtime version.
- [ ] Run focused tests and confirm the independent-version cases pass.

### Task 3: Update version policy and rationale

**Files:**
- Modify: `apps/desktop/README.md`
- Modify: `apps/desktop/README.zh.md`
- Archive: `.agents/notes/implemented/process/2026-09-16-desktop-release-version-derivation.*`
- Create: `.agents/notes/implemented/architecture/2026-10-09-desktop-version-independence.*`

- [ ] Document that Desktop product releases use the Desktop manifest version and the bundled DSH runtime retains the root DSH version.
- [ ] Update the paired release-version examples and rules without changing the existing test-build index policy.
- [ ] Record the reason and verification for the independent-version decision in a paired implemented Agent Note.

### Task 4: Verify the release boundary

- [ ] Run `pnpm exec vitest run apps/desktop/tests/desktop-upload-plan.spec.ts apps/desktop/tests/package-target-stages.spec.ts apps/desktop/tests/packaged-runtime-verification.spec.ts`.
