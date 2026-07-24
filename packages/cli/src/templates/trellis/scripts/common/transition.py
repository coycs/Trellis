"""Strict task lifecycle transitions."""

from __future__ import annotations

import hashlib
import os
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .git import run_git
from .io import read_json, write_json


ARTIFACTS = ("prd.md", "design.md", "implement.md")
SCHEMA_VERSION = 2


class TransitionError(RuntimeError):
    """Raised when a lifecycle transition is invalid."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hashes(task_dir: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for name in ARTIFACTS:
        path = task_dir / name
        if path.is_file() and path.read_text(encoding="utf-8").strip():
            hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes


def _workflow(task: dict) -> dict:
    meta = task.get("meta")
    workflow = meta.get("workflow") if isinstance(meta, dict) else None
    if not isinstance(workflow, dict) or workflow.get("schemaVersion") != SCHEMA_VERSION:
        raise TransitionError("implementation approval is missing")
    return workflow


def _revision(workflow: dict) -> int:
    revision = workflow.get("revision")
    if not isinstance(revision, int) or revision < 1:
        raise TransitionError("workflow revision is invalid")
    return revision


def _required_artifacts(task_dir: Path, complex_task: bool) -> dict[str, str]:
    hashes = _hashes(task_dir)
    required = ARTIFACTS if complex_task else ARTIFACTS[:1]
    missing = [name for name in required if name not in hashes]
    if missing:
        raise TransitionError(f"{', '.join(missing)} is missing or empty")
    return hashes


@contextmanager
def transition_lock(task_json: Path) -> Iterator[None]:
    """Serialize lifecycle writes for one task."""
    lock = task_json.with_name(f".{task_json.name}.transition.lock")
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise TransitionError(f"transition is already running for {task_json.parent.name}") from exc
    try:
        os.write(fd, str(os.getpid()).encode("ascii"))
        yield
    finally:
        os.close(fd)
        lock.unlink(missing_ok=True)


def approve(task_dir: Path, task_json: Path, complex_task: bool = False) -> int:
    """Approve current planning artifacts and return the new revision."""
    with transition_lock(task_json):
        task = read_json(task_json)
        if not task or task.get("status") != "planning":
            raise TransitionError("approval requires status planning")

        complex_task = (
            complex_task
            or (task_dir / "design.md").exists()
            or (task_dir / "implement.md").exists()
        )
        hashes = _required_artifacts(task_dir, complex_task)
        workflow = {
            "schemaVersion": SCHEMA_VERSION,
            "revision": 1,
            "complexity": "complex" if complex_task else "lightweight",
            "artifacts": hashes,
            "approval": {
                "approvedAt": _now(),
                "artifacts": hashes,
            },
            "evidence": [],
        }
        meta = task.get("meta")
        if not isinstance(meta, dict):
            meta = {}
            task["meta"] = meta
        meta["workflow"] = workflow
        if not write_json(task_json, task):
            raise TransitionError("failed to persist implementation approval")
        return 1


def transition(
    task_dir: Path,
    task: dict,
    target: str,
    *,
    evidence: dict | None = None,
    evidence_fresh: bool = False,
) -> dict:
    """Validate and apply the next strict lifecycle transition."""
    current = task.get("status")
    workflow = _workflow(task)
    revision = _revision(workflow)

    if (current, target) == ("planning", "in_progress"):
        complex_task = workflow.get("complexity") == "complex"
        hashes = _required_artifacts(task_dir, complex_task)
        approval = workflow.get("approval")
        if not isinstance(approval, dict) or approval.get("artifacts") != hashes:
            raise TransitionError("planning artifacts changed after approval")
        workflow["artifacts"] = hashes
    elif (current, target) == ("in_progress", "review"):
        if not evidence or evidence.get("revision") != revision:
            raise TransitionError("passing test evidence is required")
        workflow["evidence"] = [evidence]
    elif (current, target) == ("review", "completed"):
        evidence_items = workflow.get("evidence")
        latest = evidence_items[-1] if isinstance(evidence_items, list) and evidence_items else None
        if not isinstance(latest, dict) or not evidence_fresh:
            raise TransitionError("test evidence is stale")
    else:
        raise TransitionError(f"invalid transition: {current} -> {target}")

    workflow["revision"] = revision + 1
    task["status"] = target
    return task


def git_state(repo_root: Path) -> tuple[str, bool]:
    """Return HEAD and whether the worktree/index are clean."""
    rc, head, _ = run_git(["rev-parse", "HEAD"], cwd=repo_root)
    if rc != 0:
        raise TransitionError("a Git commit is required")
    rc, status, _ = run_git(["status", "--porcelain"], cwd=repo_root)
    return head.strip(), rc == 0 and not status.strip()


def is_evidence_fresh(repo_root: Path, commit: str) -> bool:
    """Return whether only Trellis metadata changed since the tested commit."""
    if not commit:
        return False
    rc, _, _ = run_git(["merge-base", "--is-ancestor", commit, "HEAD"], cwd=repo_root)
    if rc != 0:
        return False
    rc, _, _ = run_git(
        [
            "diff",
            "--quiet",
            commit,
            "HEAD",
            "--",
            ".",
            ":(exclude).trellis/**",
            ":(exclude,glob)**/.trellis/**",
        ],
        cwd=repo_root,
    )
    return rc == 0


def run_tests(repo_root: Path, command: list[str], revision: int) -> dict:
    """Run a real test command against a stable clean commit."""
    if not command:
        raise TransitionError("test command is required")
    head, clean = git_state(repo_root)
    if not clean:
        raise TransitionError("commit or discard changes before review")

    started = _now()
    try:
        result = subprocess.run(command, cwd=repo_root)
    except OSError as exc:
        raise TransitionError(f"test command failed to start: {exc}") from exc
    if result.returncode != 0:
        raise TransitionError(f"test command failed with exit code {result.returncode}")

    current_head, clean = git_state(repo_root)
    if current_head != head or not clean:
        raise TransitionError("repository changed while tests were running")
    return {
        "type": "test",
        "command": command,
        "commit": head,
        "revision": revision,
        "startedAt": started,
        "passedAt": _now(),
    }
