---
kind: upgrade-guide
description: "Remove Linux and macOS host packaging and release targets; AsterHub is now temporarily developed and released exclusively for Windows."
---

# Windows-only platform support

English | [中文](guide.zh.md)

## Change

AsterHub is now developed and released exclusively for Windows x64 (`win32-x64`). Linux and macOS host-exclusive application packaging, CI workflows, native prebuilds, and platform release paths have been removed.

- Root scripts and desktop build targets no longer offer macOS (`package:desktop:mac:*`, `upload:mac:*`, `upload:latest:mac:*`) or Linux host packaging.
- The Python SDK runtime wheel distribution is published exclusively as `deepseek-harness-runtime-bin` for `win_amd64`. Linux and macOS runtime wheels are no longer published.
- Non-Windows native addon packages (`@deepseek-ai/node-addon-system` platform packages for Linux and macOS) and host sandbox runners (`bwrap`, `landlock`, macOS Seatbelt) have been removed from the repository.
- The unused POSIX-client-only `dsh-ssh`, `dsh-fs-ssh`, `dsh-subprocess-ssh`, and `dsh-sandbox-ssh` packages are removed. Windows shell tools can still invoke an external `ssh.exe`; the removed in-tree provider is not a Windows SSH implementation. Shared third-party libraries and Windows Git Bash/PowerShell remain available.

## Migration

1. For desktop deployments, install the Windows x64 installer or launch the desktop app from source on Windows with `pnpm run dev:desktop`.
2. For Python SDK integrations, install `deepseek-harness-sdk` and the Windows runtime wheel on Windows x64. Move Linux/macOS-hosted AsterHub workloads to Windows; external SSH command execution does not restore support for running AsterHub on those hosts.
3. In CI and development environments, replace any invocations of deleted scripts (`check:ci:linux-primary`, `check:windows-wine`, `package:desktop:mac:*`) with Windows native commands (`pnpm run check:ci:windows-complete`, `pnpm run package:desktop:win:x64`).
4. Custom Cordis configuration overlays or profiles targeting Linux sandbox confinement or macOS-specific shell integrations should remove those platform-specific provider settings; Windows ACL confinement is used natively on Windows.
5. A custom `sandbox-local.runnerCommand` receives Windows policy arguments: `--workspace <resolved-root> --temp <temp-root> --mode <read-only|workspace-write> -- <command...>`. Update custom wrappers to consume and enforce those arguments; Linux `bwrap` mount flags are no longer supplied. The custom-runner configuration still asserts full enforcement and must identify its own setup failures through `runnerFailureSignatures`.
6. Anima runtime preparation accepts only Windows x64 archives and discovers `bin/java.exe`; remove Linux/macOS and ARM64 preparation targets. The browser worker remains a virtual runtime with in-process session write exclusion, not a supported Linux deployment.
