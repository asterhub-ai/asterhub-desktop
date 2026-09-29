# Aster IM source and build

This package is adapted from the MIT-licensed `xmanrui/dsh-im` project at commit `6d97c9c09823050c293eef0e740f24dda1499ba3` (version 4.32.0). The patch rebrands runtime surfaces as Aster IM/AsterHub, disables upstream self-update and the AI Office connector, and prevents model/provider/reasoning selection outside the AsterHub Host route.

The source patch is stored as `aster-im-source.patch.gz`. `build-package.ps1` checks out the pinned upstream commit, expands and applies that patch, builds the Client and Host bundles, and creates the distributable tarball. The resulting package retains the upstream MIT license and third-party notices.

The Host was smoke-tested in an isolated Desktop profile on AsterHub/DSH `0.1.6-alpha.2`. Model commands are intercepted with a workbench-managed response; per-bot model writes are rejected; legacy remote Host URLs are ignored. The application’s fixed model route remains owned by the Desktop Host.
