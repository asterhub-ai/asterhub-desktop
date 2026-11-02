"""Validate the authoring resources in staged, installed, or archived runtime wheels."""

from __future__ import annotations

import json
import re
import stat
import zipfile
from pathlib import Path


def validate_resources(root: Path | zipfile.Path, target: str) -> None:
    """Reject a missing or wrong-target Python/Node environment or bundled Office skill tree."""
    manifest_path = root / "primary-runtime/runtime.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"runtime authoring resources are missing: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or (manifest.get("platform"), manifest.get("arch")) != ("win32", "x64"):
        raise ValueError(f"runtime authoring resources do not match target {target}")
    version = manifest.get("python")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("runtime authoring resources have invalid Python version metadata")
    if not isinstance(manifest.get("pythonPackages"), dict) or not manifest["pythonPackages"]:
        raise ValueError("runtime authoring resources have no Python distributions")
    python_root = root / "primary-runtime/dependencies/python"
    executable = python_root / "python.exe"
    packages = python_root / "Lib/site-packages"
    node = root / "primary-runtime/dependencies/node/bin/node.exe"
    required = [executable, node, root / "office-skills/scripts/check_office.py"]
    required.extend(root / f"office-skills/office-{kind}/SKILL.md" for kind in ("docx", "pptx", "xlsx"))
    for path in required:
        if not path.is_file():
            raise FileNotFoundError(f"runtime authoring resource is missing: {path}")
    if not packages.is_dir():
        raise FileNotFoundError(f"runtime Python site-packages is missing: {packages}")
