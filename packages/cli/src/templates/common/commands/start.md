# Start Trellis

Run:

```bash
trellis context
trellis context --mode phase
```

Route by status:

- `no_task`: triage the request; create a task for implementation work.
- `planning`: edit planning artifacts only, then approve and start.
- `in_progress`: implement the approved plan.
- `review`: archive only when evidence is fresh.

Read `.trellis/workflow.md` when the compact context is insufficient.
