# AsterHub Upstream Upgrade Record

English | [中文](asterhub-upstream-upgrade.zh.md)

This upgrade is based on upstream `dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`. Work is in `deepseek-harness-upgrade`, branch `codex/dsh-02-upgrade`. The original `asterhub` branch and installed build are separate from this worktree.

## Product decisions

| Feature | Delivery |
| --- | --- |
| Sessions, workbench core and V4 session migration | Follow this upstream release while preserving AsterHub customizations |
| Voice input | Built in; download recognition models on first use |
| Schedule, Teams, Auto Review and Inspector | Four independent cloud-curated packages, absent from the default client |
| Model requests | Host fixes the route to `sub2api/aster`; authentication comes from the account Host credential record |
| Conversation plugin and MCP lifecycle | Any source is allowed; retain Host operation and build-script approvals |
| App Plugins page | Signed catalogue; download on demand and verify artifact URL, version and SHA-512 |

## Progress (2026-10-01)

Resolved the migration conflicts from `23431db2e2` and adapted the fixed route to the v0.2 Host startup and LLM Volatile configuration. Curated installation requires a signed same-origin `/releases/*.tgz`, verifies the direct dependency lock record and package integrity, then activates the package.

Voice input now opens its own settings modal instead of navigating to a plugin details page. The MCP installation guide lives in the new preset package and is discoverable from Standard, PTC and Creator. Default Desktop production dependencies no longer contain the Schedule, Teams, Auto Review, Inspector or legacy voice bundle packages.

Host and Client TypeScript project graphs and Host and Client bundles pass. The focused route-lock and plugin-management suites pass 197 tests; voice input passes 61 tests. Generated intermediate files under source directories were moved to a temporary backup and are not included in version control.

Remaining work: port registration, GenOffice, Aster IM and the portable launcher; build four independent curated packages and signed catalogue entries; inspect the final Desktop runtime closure; produce a usable archive. The upgrade merge is still in progress. Neither the Desktop installer nor the live service/catalogue was published in this work.

For future DSH upgrades, pin the upstream version and list its differences first, then migrate only the features selected for AsterHub. Keep custom policy in product composition and Host boundaries instead of replacing whole core files from an older release.
