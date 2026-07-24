# Trellis Workflow

Trellis uses one strict lifecycle:

`planning → in_progress → review → completed`

The CLI is the runtime. Project directories contain state and specifications,
not executable workflow scripts.

[workflow-state:no_task]
Classify the request first. Answer trivial read-only questions directly.
For implementation work, create a task with `trellis task create "<title>"`.
[/workflow-state:no_task]

[workflow-state:planning]
Work only on requirements and planning artifacts. Do not edit product code.
Approve the stable plan with `trellis task approve <task>`; add `--complex`
when `design.md` and `implement.md` are required. Then run
`trellis task start <task>`.
[/workflow-state:planning]

[workflow-state:in_progress]
Implement the approved plan, keep the change minimal, update affected specs,
run focused checks, and commit. Then record reproducible evidence with
`trellis task review <task> -- <test-command...>`.
[/workflow-state:in_progress]

[workflow-state:review]
Do not change code. Confirm the review evidence belongs to the current commit,
then run `trellis task archive <task>`. Any code change invalidates the
evidence and requires another review.
[/workflow-state:review]

[workflow-state:completed]
The task is complete. Start a new task for additional implementation work.
[/workflow-state:completed]

## Phase Index

| Status | Goal | Exit command |
|---|---|---|
| `no_task` | Triage or create a task | `trellis task create` |
| `planning` | Stabilize and approve artifacts | `trellis task approve`, `trellis task start` |
| `in_progress` | Implement, verify, commit | `trellis task review` |
| `review` | Archive fresh evidence | `trellis task archive` |

Load this table with `trellis context --mode phase`. Load one step with
`trellis context --mode phase --step <id>`.

## Phase 1: Planning

#### 1.1 Create

Run `trellis task create "<title>" --slug <slug>`. The command creates
`prd.md`, records `status=planning`, and attaches the task to the current AI
session.

#### 1.2 Define

Write a lossless `prd.md` with the goal and testable acceptance criteria.
For complex work, also write:

- `design.md`: boundaries, data flow, decisions, and risks.
- `implement.md`: ordered implementation and verification steps.

#### 1.3 Approve

Use `trellis task approve <task>` for lightweight work or
`trellis task approve <task> --complex` for complex work. Approval hashes the
required artifacts; editing them after approval blocks start.

#### 1.4 Start

Run `trellis task start <task>`. Implementation is forbidden before this gate.

## Phase 2: Implementation

#### 2.1 Implement

Read the approved artifacts and relevant `.trellis/spec/` files. Make the
smallest coherent change. Remove superseded code instead of keeping
compatibility branches unless the requirement explicitly asks for them.

#### 2.2 Verify

Run focused checks while iterating. Update specifications when behavior or
architecture changes. Commit product and spec changes before review.

#### 2.3 Review

Run `trellis task review <task> -- <test-command...>`. Review requires a clean
product worktree, executes the exact command, and stores the command, commit,
workflow revision, and timestamp as evidence.

## Phase 3: Completion

#### 3.1 Archive

Run `trellis task archive <task>`. Archive succeeds only from `review` with
fresh passing evidence for the current commit. It marks the task completed,
moves it under `.trellis/tasks/archive/<YYYY-MM>/`, and clears active session
pointers.

## Operating Rules

- One task is active per AI session.
- Planning artifacts are immutable after approval unless re-approved.
- A test result without its command and commit is not evidence.
- Code changes after review invalidate the review.
- Hooks only inject context; lifecycle transitions happen through `trellis task`.
- Platform integrations call `trellis hook`; no project-local runtime exists.
