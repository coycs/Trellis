"""Executable gates for task workflow transitions."""

from __future__ import annotations

import hashlib
import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .io import read_json, write_json


SCHEMA_VERSION = 1
ARTIFACT_NAMES = ("prd.md", "design.md", "implement.md")


class WorkflowLockError(RuntimeError):
    """Raised when another process owns a task transition lock."""


@dataclass(frozen=True)
class GateResult:
    """Result of evaluating a planning-to-implementation transition."""

    allowed: bool
    issues: tuple[str, ...]


def _artifact_hash(path: Path) -> str:
    """Return a stable SHA-256 digest for an artifact."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _current_artifacts(task_dir: Path) -> dict[str, str]:
    """Return hashes for present, non-empty planning artifacts."""
    artifacts: dict[str, str] = {}
    for name in ARTIFACT_NAMES:
        path = task_dir / name
        try:
            if path.is_file() and path.read_text(encoding="utf-8").strip():
                artifacts[name] = _artifact_hash(path)
        except OSError:
            continue
    return artifacts


def _workflow_state(task_data: dict, mode: str) -> dict:
    """Return normalized workflow metadata without mutating task data."""
    meta = task_data.get("meta")
    workflow = meta.get("workflow") if isinstance(meta, dict) else None
    if not isinstance(workflow, dict):
        workflow = {}

    approvals = workflow.get("approvals")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "mode": mode,
        "revision": workflow.get("revision", 0),
        "complexity": workflow.get("complexity", "lightweight"),
        "artifacts": workflow.get("artifacts", {}),
        "approvals": approvals if isinstance(approvals, list) else [],
        "evidence": workflow.get("evidence", []),
        "reviews": workflow.get("reviews", []),
    }


def _store_workflow_state(task_data: dict, workflow: dict) -> None:
    """Store normalized workflow metadata on a task object."""
    meta = task_data.get("meta")
    if not isinstance(meta, dict):
        meta = {}
        task_data["meta"] = meta
    meta["workflow"] = workflow


def _next_revision(workflow: dict) -> int:
    """Return the next positive workflow revision."""
    try:
        return max(0, int(workflow.get("revision", 0))) + 1
    except (TypeError, ValueError):
        return 1


def _is_complex(task_dir: Path, workflow: dict, explicit: bool = False) -> bool:
    """Infer complex planning from metadata, flag, or technical artifacts."""
    return (
        explicit
        or workflow.get("complexity") == "complex"
        or (task_dir / "design.md").exists()
        or (task_dir / "implement.md").exists()
    )


def _artifact_issues(task_dir: Path, complex_task: bool) -> list[str]:
    """Return missing or empty artifact diagnostics."""
    required = ["prd.md"]
    if complex_task:
        required.extend(("design.md", "implement.md"))

    issues: list[str] = []
    for name in required:
        path = task_dir / name
        try:
            content = path.read_text(encoding="utf-8") if path.is_file() else ""
        except OSError:
            content = ""
        if not content.strip():
            issues.append(f"{name} is missing or empty")
    return issues


@contextmanager
def task_transition_lock(task_json_path: Path) -> Iterator[None]:
    """Serialize approval and transition writes with an exclusive lock file."""
    lock_path = task_json_path.with_name(f".{task_json_path.name}.workflow.lock")
    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise WorkflowLockError(
            f"workflow transition is already running for {task_json_path.parent.name}"
        ) from exc

    try:
        os.write(fd, str(os.getpid()).encode("ascii"))
        yield
    finally:
        os.close(fd)
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass


def approve_implementation(
    task_dir: Path,
    task_json_path: Path,
    mode: str,
    explicit_complex: bool = False,
) -> tuple[bool, str]:
    """Record implementation approval bound to current artifact hashes."""
    with task_transition_lock(task_json_path):
        task_data = read_json(task_json_path)
        if not task_data:
            return False, "task.json is missing or invalid"
        if task_data.get("status") != "planning":
            return False, "implementation approval is only valid while status is planning"

        workflow = _workflow_state(task_data, mode)
        complex_task = _is_complex(task_dir, workflow, explicit_complex)
        issues = _artifact_issues(task_dir, complex_task)
        if issues:
            return False, "; ".join(issues)

        artifacts = _current_artifacts(task_dir)
        revision = _next_revision(workflow)
        approval = {
            "action": "implementation",
            "approvedAt": datetime.now(timezone.utc).isoformat(),
            "revision": revision,
            "artifacts": artifacts,
        }
        workflow.update(
            {
                "mode": mode,
                "revision": revision,
                "complexity": "complex" if complex_task else "lightweight",
                "artifacts": artifacts,
            }
        )
        workflow["approvals"].append(approval)
        _store_workflow_state(task_data, workflow)
        if not write_json(task_json_path, task_data):
            return False, "failed to persist implementation approval"
    return True, f"implementation approved at revision {revision}"


def evaluate_start(task_dir: Path, task_data: dict, mode: str) -> GateResult:
    """Evaluate the planning-to-in-progress transition."""
    if mode == "off":
        return GateResult(True, ())

    workflow = _workflow_state(task_data, mode)
    complex_task = _is_complex(task_dir, workflow)
    issues = _artifact_issues(task_dir, complex_task)
    current_artifacts = _current_artifacts(task_dir)

    approval = next(
        (
            item
            for item in reversed(workflow["approvals"])
            if isinstance(item, dict) and item.get("action") == "implementation"
        ),
        None,
    )
    if approval is None:
        issues.append("implementation approval is missing")
    elif approval.get("artifacts") != current_artifacts:
        issues.append("planning artifacts changed after implementation approval")

    return GateResult(mode != "strict" or not issues, tuple(issues))


def apply_start_transition(
    task_dir: Path,
    task_data: dict,
    mode: str,
) -> dict:
    """Apply the planning-to-in-progress transition to a task object."""
    task_data["status"] = "in_progress"
    if mode == "off":
        return task_data

    workflow = _workflow_state(task_data, mode)
    workflow.update(
        {
            "mode": mode,
            "revision": _next_revision(workflow),
            "artifacts": _current_artifacts(task_dir),
        }
    )
    _store_workflow_state(task_data, workflow)
    return task_data
