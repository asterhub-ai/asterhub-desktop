---
description: "Use to control and automate AsterHub's built-in Desktop Sidebar Browser through typed tools."
---

# Control Browser

Operate AsterHub's built-in Desktop Sidebar Browser to inspect web pages, perform web actions, and automate browser tasks.

## Tool Inventory

1. `browser_tabs()` — List open tabs for the current Session, including active status, title, URL, and target generation.
2. `browser_open({ url, newTab? }) — Navigate the active tab to a URL or open a new tab.
3. `browser_close({ target })` — Close a specific tab target `{ tabId, generation }`.
4. `browser_snapshot({ target })` — Capture the accessible DOM structure and assigned element references.
5. `browser_read({ target, locator, property, attribute? })` — Read element property (`text`, `attribute`, `visible`, `enabled`, `checked`).
6. `browser_act({ target, ... })` — Execute a semantic action (`click`, `doubleClick`, `fill`, `type`, `press`, `check`, `uncheck`, `select`, `hover`) or coordinate pointer action (`click`, `doubleClick`, `move`, `scroll`, `drag`).
7. `browser_wait({ target, condition })` — Wait for page load (`domcontentloaded`), URL match, or element state (`visible`, `hidden`, `enabled`, `checked`).
8. `browser_screenshot({ target })` — Capture the viewport PNG as a durable image attachment (image-capable models only).

## Operating Guidelines

### 1. Discovery and Tab Selection
- Always check open tabs first using `browser_tabs` before navigating.
- If a tab with the target URL or domain is already open, reuse its `{ tabId, generation }` instead of creating unnecessary tabs.
- When opening a new page or navigating, use `browser_open` and capture the returned `target`.

### 2. Synchronization and Waiting
- After navigation or page-modifying actions, use `browser_wait` to confirm page readiness before inspecting elements.
- Prefer explicit wait conditions (`kind: 'load'`, `kind: 'url'`, or element state) over arbitrary guessing.

### 3. DOM Inspection and Targeting
- Call `browser_snapshot` to inspect page structure.
- Element locators must be derived from the latest snapshot:
  - Role locators: `{ kind: 'role', snapshotId, role, name, exact: true }`
  - Ref locators: `{ kind: 'ref', snapshotId, ref }`
- Avoid ambiguous role/name matches; if strict matching fails due to duplicates, use unique refs from the snapshot.

### 4. Executing Actions and Verifying Outcomes
- Follow the principle of **one action followed by verification**:
  - Dispatch the action using `browser_act`.
  - Verify the result using `browser_read`, a new `browser_snapshot`, or `browser_screenshot`.
- For form inputs, use `fill` with `text`. For submission, click the submit control or use `press` with `keys: ['Enter']`.
- If an action reports uncertain delivery or timeout, re-observe state with `browser_snapshot` rather than blindly repeating the action.

### 5. Stale Targets and Snapshot Recovery
- Target generation increases when the page navigates (`target.generation`).
- Snapshot IDs (`snapshotId`) expire when new DOM snapshots are generated.
- When receiving a `stale-target` error or expired snapshot error, call `browser_snapshot` to obtain a fresh target and active snapshot.

### 6. Screenshots and Visual Feedback
- Capture screenshots with `browser_screenshot` only when visual layout, charts, or images need verification.
- Route screenshots only when operating with an image-capable model.
- Coordinate-grounded pointer actions require a `screenshotId` from the active snapshot or screenshot.
