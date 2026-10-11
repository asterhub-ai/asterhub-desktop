---
description: "Desktop-owned composition for native scheduled tasks, their management panel, clock context, and built-in browser tools."
kind: "package-bundle"
---

# @deepseek-ai/dsh-asterhub-desktop-native

English | [中文](README.zh.md)

## Summary

Use the AsterHub desktop app to manage scheduled work and operate its built-in browser. The desktop profile mounts this bundle after the shared application composition. Tasks run while the app is open and each execution creates a fresh Session.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

The desktop application owns installation and activation of this private bundle. Its [overlay](cordis.patch.yml) mounts the native automation Host, task panel, clock context, browser-use registry, and desktop browser provider. It is not a separate product entry point.

## Understand the implementation

The overlay uses desktop-owned row IDs and runs after the shared Web renderer composition. The native automation service and panel replace the optional Schedule bundle; the clock row uses the maintained time-context package. Browser operations travel over the private Desktop Host IPC channel.

## Further Exploration

- [Automation Host](../../schedule/asterhub-automation/README.md)
- [Task panel](../../client/ui-asterhub-automation/README.md)
- [Desktop browser provider](../../browser-use/browser-use-desktop/README.md)

## Model Experience

Indirectly, through the clock, native automation, and browser providers mounted by the overlay.

#### KV Cache effect

The mounted providers own prompt, tool-schema, and result content; enabling or disabling their rows can change the model request prefix.

## Known Limitations and Deferred Work

- Requires the Electron desktop shell and its private IPC services.
- The application must remain running for scheduled tasks; this bundle does not install an operating-system background scheduler.

### Dev Note

Keep desktop-only rows in this overlay and its declared resolver dependencies.
