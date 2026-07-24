# Finish Trellis Task

Run `trellis context` and confirm the task is in `review`.

If product files changed after review, commit them and run
`trellis task review <task> -- <test-command...>` again.

When evidence belongs to the current commit, run:

```bash
trellis task archive <task>
```

Do not create a separate session journal; the task artifacts, git history, and
stored review evidence are the durable record.
