# Continue Trellis Task

Run `trellis context`, then load the relevant step:

```bash
trellis context --mode phase --step <id> --platform {{CLI_FLAG}}
```

Follow the current status without skipping its exit gate:

- `planning` → `trellis task approve`, then `trellis task start`
- `in_progress` → implement, verify, commit, then `trellis task review`
- `review` → `trellis task archive`
