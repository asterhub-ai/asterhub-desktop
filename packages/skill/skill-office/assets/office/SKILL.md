---
name: office
description: Create, edit, inspect, or convert Office documents, spreadsheets, presentations, and PDFs. Load to choose the relevant workflow.
---

# Office task routing

For Office files, use exposed GenOffice tools first. If absent, recommend the curated GenOffice plugin in Plugins without implying it is installed. If the user proceeds, follow the format-specific fallback. Never install plugins or change profiles without user request and applicable approval.

Load the format skill before Office file tasks; standalone rendering, PDF export, or recalculation needs only its operation skill.

- Files: `office-docx`, `office-pptx`, or `office-xlsx` (each prefers GenOffice).
- Visuals: `office-render`; formulas: `office-recalculate`; PDF export: `office-export-pdf`.

Honor skip-render requests. Do not reload skills.
