---
name: trellis-meta
description: "Understand or modify Trellis workflow, task state, context hooks, specs, channels, or memory."
---

# Trellis Meta

Trellis has four layers:

- `trellis task`: strict task lifecycle and review evidence.
- `trellis context` / `trellis hook`: context rendering and platform envelopes.
- `.trellis/workflow.md`, `.trellis/tasks/`, `.trellis/spec/`: project state.
- `trellis channel` / `trellis mem`: optional collaboration and local recall.

The CLI is the only workflow runtime. A generated project must not contain
executable Trellis scripts.

## Diagnose

1. Run `trellis --help` and the relevant subcommand help.
2. Read `.trellis/workflow.md`, the active task, and affected specs.
3. Inspect the platform JSON/TOML configuration that invokes `trellis hook`.
4. Use `.trellis/.template-hashes.json` to distinguish generated files from
   user-owned changes.

## Modify

- Change project rules in `.trellis/spec/`.
- Change project flow in `.trellis/workflow.md`.
- Change the reusable runtime in the Trellis TypeScript source and publish or
  link that CLI; do not recreate project-local runtimes.
- Keep platform files declarative and delegate context to `trellis hook`.

## Invariants

- Lifecycle: `planning → in_progress → review → completed`.
- Approved artifacts are content-hashed.
- Review evidence records the command, commit, revision, and timestamp.
- Archive requires fresh evidence for the current commit.
- Hooks inject context but never mutate lifecycle state.
- Preserve user-owned files when updating generated assets.
