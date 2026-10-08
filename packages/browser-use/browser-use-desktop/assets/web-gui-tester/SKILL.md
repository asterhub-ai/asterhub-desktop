---
description: "Use for systematic web GUI testing: validating main flows, user feedback, boundary conditions, and layout in AsterHub's Sidebar Browser."
---

# Web GUI Tester

Conduct systematic end-to-end GUI testing for web applications in AsterHub's built-in Desktop Sidebar Browser.

## Test Priority Tiers

### P0: Critical Main Flows
- **Page Load & Routing**: Verify initial URL resolves with valid DOM title and header elements.
- **Form Submissions**: Complete required fields, submit forms, and assert successful outcomes (success banner, redirect, or updated list).
- **Core State Transitions**: Verify primary user journeys from entry to completion.

### P1: Feedback & Interactive States
- **Validation Notices**: Test missing required fields and assert appropriate inline or modal validation messages.
- **Loading & Progress**: Confirm busy states (`aria-busy`, spinner, or disabled buttons) during network latency.
- **Error Banners**: Test server or client error states and verify user-facing error text.

### P2: Boundaries & Edge Cases
- **Extreme Inputs**: Test maximum character lengths, zero-length strings, and whitespace padding.
- **Unicode & Special Characters**: Test multilingual text, symbols, and emoji input handling.
- **Duplicate & Covered Controls**: Ensure duplicate labels are differentiated and occluded elements are not clicked through.

### P3: Visual & Layout Verification
- **Visual Presentation**: Capture screenshots via `browser_screenshot` to verify layout alignment and styling.
- **Element Visibility**: Verify that dropdowns, modals, and tooltips are unoccluded and properly positioned.

## Testing Protocol

1. **Environment Preparation**
   - Confirm target server is up and responsive before starting GUI execution.
   - Separate test fixture setup from formal assertion runs.

2. **Test Execution**
   - Use only standard user interactions through browser tools (`browser_open`, `browser_act`, `browser_snapshot`, `browser_read`, `browser_wait`).
   - Never bypass failed UI flows by modifying application source code, invoking direct API endpoints, or injecting script hacks.

3. **Evidence and Reporting**
   - For every test case, log:
     - **Status**: `PASSED`, `FAILED`, `BLOCKED`, or `UNSUPPORTED`.
     - **Action Taken**: Detailed input parameters and locators used.
     - **Observed Result**: Concrete read property values, snapshot references, or screenshot attachments.
   - If a test fails, capture an immediate screenshot and state the exact divergence between expected and observed behavior.
