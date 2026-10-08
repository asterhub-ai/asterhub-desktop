---
kind: upgrade-guide
description: "Migrate default global home to .asterhub and adopt project-local session and attachment storage."
---

# Project-local history and portable attachments

English | [中文](guide.zh.md)

## Change

AsterHub updates its default global home from `~/.dsh` to `~/.asterhub` while preserving explicit `DSH_HOME` overrides. Projects store conversation history and original binary attachments locally in `<project>/.aster/` rather than in a global central directory.

Each project owns a portable manifest at `<project>/.aster/project.json` recording project identity, session membership, display ordering, and pin/archive state. Historical session generations are preserved immutably under `<project>/.aster/sessions/`, and original attachment files and normalized images reside in `<project>/.aster/attachments/v1/`.

When moving or copying a project to another computer, selecting the folder in the directory picker inspects the directory in read-only mode and prompts for confirmation with verified project details. The current execution working directory resolves from the current project binding rather than the historical header directory. The `.aster/` directory is automatically excluded in `.gitignore` before writing private project data.

## Migration

1. Default home migration: On first launch, AsterHub prepares `~/.asterhub` by staging and copying existing data from `~/.dsh` under an atomic lock, recording completion and preserving the original `~/.dsh` intact. If you set `DSH_HOME` explicitly, your configured path remains authoritative and no migration occurs.
2. Existing project discovery: When opening a copied project on another machine, AsterHub detects `.aster/project.json` and presents a confirmation dialog with the project name and session count. Confirming opens the project with its historical sessions and attachments; cancelling makes no disk modifications.
3. Git exclusion: AsterHub appends `.aster/` to the project's `.gitignore` if not already present, preserving file line endings and formatting. If `.aster/` was previously committed or staged to Git, AsterHub warns of tracked private data without modifying or deleting Git index files.
4. Downgrade precaution: Do not run earlier versions of AsterHub that lack project-local storage support against projects containing `.aster/` data without a backup.
