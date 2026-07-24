/**
 * Tests for brainstorm-window phase slicing.
 *
 * brainstorm window = [trellis task create, trellis task start)
 *
 * Boundary signals are recovered from raw Claude JSONL `tool_use` blocks, so
 * `collectClaudeTurnsAndEvents` does its own pass producing both cleaned turns
 * and `trellis task` event metadata.
 *
 * Migrated from the CLI `mem-phase-slice` suite.
 */

import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

const { fakeHome } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const f = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const o = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require("node:path") as typeof import("node:path");
  const fakeHome = f.mkdtempSync(p.join(o.tmpdir(), "trellis-mem-phase-"));
  return { fakeHome };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => fakeHome };
});

const { parseTaskCommand, parseTaskCommandsAll, buildBrainstormWindows } =
  await import("../../src/mem/phase.js");
const { collectClaudeTurnsAndEvents } =
  await import("../../src/mem/adapters/claude.js");
const { collectCodexTurnsAndEvents, commandFromCodexArguments } =
  await import("../../src/mem/adapters/codex.js");
const { collectPiTurnsAndEvents } =
  await import("../../src/mem/adapters/pi.js");
import type { MemSessionInfo, TaskEvent } from "../../src/mem/types.js";

afterAll(() => {
  nodeFs.rmSync(fakeHome, { recursive: true, force: true });
});

// =============================================================================
// parseTaskCommand — invoker / path-separator variants + false-positive guard
// =============================================================================

describe("parseTaskCommand", () => {
  it("returns null for empty / non-string input", () => {
    expect(parseTaskCommand("")).toBeNull();
    expect(parseTaskCommand("ls")).toBeNull();
    // @ts-expect-error testing runtime guard
    expect(parseTaskCommand(undefined)).toBeNull();
  });

  it('matches `trellis task create "foo"`', () => {
    const r = parseTaskCommand('trellis task create "fix bug"');
    expect(r).toEqual({
      action: "create",
      slug: undefined,
      titleArg: "fix bug",
    });
  });

  it("matches `trellis task create ...`", () => {
    const r = parseTaskCommand("trellis task create my-task");
    expect(r?.action).toBe("create");
  });

  it("matches `trellis task create ...` (Windows launcher)", () => {
    const r = parseTaskCommand("trellis task create foo");
    expect(r?.action).toBe("create");
  });

  it("matches Windows backslash path (single)", () => {
    const r = parseTaskCommand("trellis task start .trellis\\tasks\\05-08-foo");
    expect(r).toEqual({
      action: "start",
      taskDir: ".trellis\\tasks\\05-08-foo",
    });
  });

  it("matches Windows backslash path (double — JSONL re-escape)", () => {
    const r = parseTaskCommand("trellis task create my-task");
    expect(r?.action).toBe("create");
  });

  it("matches `trellis task start` with no invoker prefix", () => {
    const r = parseTaskCommand("trellis task start .trellis/tasks/05-08-foo/");
    expect(r).toEqual({
      action: "start",
      taskDir: ".trellis/tasks/05-08-foo/",
    });
  });

  it("matches absolute path", () => {
    const r = parseTaskCommand("trellis task create new-thing");
    expect(r?.action).toBe("create");
  });

  it("captures --slug FOO flag value", () => {
    const r = parseTaskCommand('trellis task create "Title" --slug my-slug');
    expect(r).toMatchObject({ action: "create", slug: "my-slug" });
  });

  it("captures --slug=FOO equals form", () => {
    const r = parseTaskCommand("trellis task create --slug=my-slug");
    expect(r).toMatchObject({ action: "create", slug: "my-slug" });
  });

  it("does NOT match `--slug trellis task-create-foo` (false-positive guard)", () => {
    expect(parseTaskCommand("ls --slug trellis task-create-foo")).toBeNull();
  });

  it("does NOT match arbitrary text containing trellis task without verb", () => {
    expect(parseTaskCommand("see trellis task for details")).toBeNull();
  });

  it("does NOT match `trellis task update` (only create/start are signals)", () => {
    expect(parseTaskCommand("trellis task update foo")).toBeNull();
  });

  it("rejects `trellis task-create` (must have whitespace before verb)", () => {
    expect(parseTaskCommand("trellis task-create foo")).toBeNull();
  });
});

// =============================================================================
// parseTaskCommandsAll — dogfood-driven edge cases
// =============================================================================

function ev(
  action: "create" | "start",
  turnIndex: number,
  extra: { slug?: string; taskDir?: string } = {},
): TaskEvent {
  return {
    action,
    timestamp: `2026-05-08T00:00:0${turnIndex}Z`,
    turnIndex,
    ...extra,
  };
}

describe("parseTaskCommandsAll (dogfood-driven edge cases)", () => {
  it("strips $(...) closing paren from --slug value", () => {
    const all = parseTaskCommandsAll(
      'TASK_DIR=$(trellis task create "fix: tl mem --since drops cross-day sessions" --slug mem-since-cross-day-filter)',
    );
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      action: "create",
      slug: "mem-since-cross-day-filter",
    });
  });

  it("captures BOTH trellis task invocations in one Bash command", () => {
    const cmd =
      'SMOKE_TASK=$(trellis task create "smoke" 2>&1); trellis task start ".trellis/tasks/$SMOKE_TASK" 2>&1 | tail -3';
    const all = parseTaskCommandsAll(cmd);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ action: "create" });
    expect(all[1]).toMatchObject({ action: "start" });
    if (all[1] && all[1].action === "start") {
      expect(all[1].taskDir).toContain("$SMOKE_TASK");
    }
  });

  it("rejects prose-embedded matches (heredoc / commit-message text)", () => {
    const cmd =
      'git commit -m "Previous text said `.current-task` is a CLI fallback. Current code never writes that file — trellis task start exits with hint to set TRELLIS_CONTEXT_ID."';
    expect(parseTaskCommandsAll(cmd)).toEqual([]);
  });

  it("rejects empty restRaw (no positional, just trailing whitespace)", () => {
    expect(parseTaskCommandsAll("trellis task start  ")).toEqual([]);
  });

  it("does not match action embedded in flag value (--something=trellis task-create-foo)", () => {
    expect(
      parseTaskCommandsAll("foo --bar=trellis task-create-baz xyz"),
    ).toEqual([]);
  });
});

describe("slugFromTaskDir (via buildBrainstormWindows pairing)", () => {
  it("pairs --slug FOO with start .trellis/tasks/MM-DD-FOO via prefix strip", () => {
    const events: TaskEvent[] = [
      {
        action: "create",
        timestamp: "2026-05-08T00:00:05Z",
        turnIndex: 5,
        slug: "mem-fix",
      },
      {
        action: "start",
        timestamp: "2026-05-08T00:00:10Z",
        turnIndex: 10,
        taskDir: ".trellis/tasks/05-08-mem-fix",
      },
    ];
    const ws = buildBrainstormWindows(events, 20);
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({
      label: "mem-fix",
      startTurn: 5,
      endTurn: 10,
    });
  });
});

// =============================================================================
// buildBrainstormWindows — pairing strategy + fallbacks
// =============================================================================

describe("buildBrainstormWindows", () => {
  it("returns [] when there are no events", () => {
    expect(buildBrainstormWindows([], 10)).toEqual([]);
  });

  it("pairs a single create→start in order", () => {
    const events = [ev("create", 2, { slug: "foo" }), ev("start", 8)];
    expect(buildBrainstormWindows(events, 12)).toEqual([
      { label: "foo", startTurn: 2, endTurn: 8 },
    ]);
  });

  it("pairs multi-task FIFO when slugs are missing", () => {
    const events = [
      ev("create", 1),
      ev("start", 3, { taskDir: ".trellis/tasks/aaa" }),
      ev("create", 5),
      ev("start", 9, { taskDir: ".trellis/tasks/bbb" }),
    ];
    expect(buildBrainstormWindows(events, 12)).toEqual([
      { label: "aaa", startTurn: 1, endTurn: 3 },
      { label: "bbb", startTurn: 5, endTurn: 9 },
    ]);
  });

  it("prefers slug match over FIFO order", () => {
    const events = [
      ev("create", 1, { slug: "aaa" }),
      ev("create", 2, { slug: "bbb" }),
      ev("start", 5, { taskDir: ".trellis/tasks/bbb" }),
      ev("start", 6, { taskDir: ".trellis/tasks/aaa" }),
    ];
    expect(buildBrainstormWindows(events, 10)).toEqual([
      { label: "aaa", startTurn: 1, endTurn: 6 },
      { label: "bbb", startTurn: 2, endTurn: 5 },
    ]);
  });

  it("fallback A: create with no following start → [create, totalTurns)", () => {
    const events = [ev("create", 4, { slug: "interrupted" })];
    expect(buildBrainstormWindows(events, 12)).toEqual([
      { label: "interrupted", startTurn: 4, endTurn: 12 },
    ]);
  });

  it("fallback B: start with no preceding create → [0, start)", () => {
    const events = [ev("start", 7, { taskDir: ".trellis/tasks/earlier" })];
    expect(buildBrainstormWindows(events, 12)).toEqual([
      { label: "earlier", startTurn: 0, endTurn: 7 },
    ]);
  });

  it("skips malformed window where start.turnIndex < create.turnIndex (event order quirk)", () => {
    const events = [
      ev("create", 8, { slug: "weird" }),
      ev("start", 3, { taskDir: ".trellis/tasks/weird" }),
    ];
    expect(buildBrainstormWindows(events, 10)).toEqual([]);
  });

  it("uses window-N label when neither create.slug nor start.taskDir resolve", () => {
    const events = [ev("create", 1), ev("start", 5)];
    expect(buildBrainstormWindows(events, 10)).toEqual([
      { label: "window-1", startTurn: 1, endTurn: 5 },
    ]);
  });
});

// =============================================================================
// collectClaudeTurnsAndEvents — end-to-end raw JSONL → turns + events
// =============================================================================

const CLAUDE_PROJECTS = nodePath.join(fakeHome, ".claude", "projects");

function writeJsonl(file: string, lines: readonly unknown[]): void {
  nodeFs.mkdirSync(nodePath.dirname(file), { recursive: true });
  nodeFs.writeFileSync(
    file,
    lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
  );
}

function rimraf(p: string): void {
  nodeFs.rmSync(p, { recursive: true, force: true });
}

describe("collectClaudeTurnsAndEvents", () => {
  const projectCwd = "/tmp/phase-slice";
  const projectDir = nodePath.join(
    CLAUDE_PROJECTS,
    projectCwd.replace(/[/_]/g, "-"),
  );

  afterEach(() => {
    rimraf(CLAUDE_PROJECTS);
  });

  function buildSession(
    sessionId: string,
    events: readonly Record<string, unknown>[],
  ): MemSessionInfo {
    nodeFs.mkdirSync(projectDir, { recursive: true });
    const file = nodePath.join(projectDir, `${sessionId}.jsonl`);
    writeJsonl(file, events);
    return { platform: "claude", id: sessionId, filePath: file };
  }

  it("captures trellis task create + start events with correct turnIndex", () => {
    const s = buildSession("session-a", [
      {
        type: "user",
        timestamp: "2026-05-08T00:00:00Z",
        cwd: projectCwd,
        message: { role: "user", content: "let's brainstorm something" },
      },
      {
        type: "assistant",
        timestamp: "2026-05-08T00:00:01Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "OK, what is it?" }],
        },
      },
      {
        type: "user",
        timestamp: "2026-05-08T00:00:02Z",
        message: { role: "user", content: "do task X" },
      },
      {
        type: "assistant",
        timestamp: "2026-05-08T00:00:03Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "creating the task now" },
            {
              type: "tool_use",
              name: "Bash",
              input: {
                command: 'trellis task create "task X" --slug task-x',
              },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2026-05-08T00:00:04Z",
        message: { role: "user", content: "go" },
      },
      {
        type: "assistant",
        timestamp: "2026-05-08T00:00:05Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "starting the task" },
            {
              type: "tool_use",
              name: "Bash",
              input: {
                command: "trellis task start .trellis/tasks/task-x",
              },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2026-05-08T00:00:06Z",
        message: { role: "user", content: "implementing now" },
      },
    ]);

    const { turns, events } = collectClaudeTurnsAndEvents(s);

    expect(turns.length).toBe(7);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      action: "create",
      slug: "task-x",
      turnIndex: 3,
    });
    expect(events[1]).toMatchObject({
      action: "start",
      taskDir: ".trellis/tasks/task-x",
      turnIndex: 5,
    });

    const windows = buildBrainstormWindows(events, turns.length);
    expect(windows).toEqual([{ label: "task-x", startTurn: 3, endTurn: 5 }]);
    const brainstorm = turns.slice(3, 5);
    expect(brainstorm.map((t) => t.role)).toEqual(["assistant", "user"]);
    expect(brainstorm[1]?.text).toBe("go");
  });

  it("ignores non-trellis task Bash tool_use events", () => {
    const s = buildSession("session-b", [
      {
        type: "user",
        timestamp: "2026-05-08T00:00:00Z",
        cwd: projectCwd,
        message: { role: "user", content: "hi" },
      },
      {
        type: "assistant",
        timestamp: "2026-05-08T00:00:01Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "running ls" },
            { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
          ],
        },
      },
    ]);
    expect(collectClaudeTurnsAndEvents(s).events).toEqual([]);
  });

  it("survives compaction: turns reset, subsequent trellis task events still tracked", () => {
    const s = buildSession("session-c", [
      {
        type: "user",
        timestamp: "2026-05-08T00:00:00Z",
        cwd: projectCwd,
        message: { role: "user", content: "early talk" },
      },
      {
        type: "assistant",
        timestamp: "2026-05-08T00:00:01Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "early reply" }],
        },
      },
      {
        type: "user",
        timestamp: "2026-05-08T00:00:02Z",
        isCompactSummary: true,
        message: { role: "user", content: "summarized history" },
      },
      {
        type: "user",
        timestamp: "2026-05-08T00:00:03Z",
        message: { role: "user", content: "continuing" },
      },
      {
        type: "assistant",
        timestamp: "2026-05-08T00:00:04Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "creating" },
            {
              type: "tool_use",
              name: "Bash",
              input: {
                command: "trellis task create --slug post-compact",
              },
            },
          ],
        },
      },
    ]);

    const { turns, events } = collectClaudeTurnsAndEvents(s);
    expect(turns.length).toBe(3);
    expect(turns[0]?.text.startsWith("[compact summary]")).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "create",
      slug: "post-compact",
      turnIndex: 2,
    });
  });

  it("compaction discards PRE-compact trellis task events (turnIndex no longer valid)", () => {
    const s = buildSession("session-d", [
      {
        type: "user",
        timestamp: "2026-05-08T00:00:00Z",
        cwd: projectCwd,
        message: { role: "user", content: "pre-compact talk" },
      },
      {
        type: "assistant",
        timestamp: "2026-05-08T00:00:01Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "creating ahead of compact" },
            {
              type: "tool_use",
              name: "Bash",
              input: {
                command: "trellis task create --slug stale",
              },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2026-05-08T00:00:02Z",
        isCompactSummary: true,
        message: { role: "user", content: "summary" },
      },
      {
        type: "user",
        timestamp: "2026-05-08T00:00:03Z",
        message: { role: "user", content: "after compact" },
      },
    ]);

    expect(collectClaudeTurnsAndEvents(s).events).toEqual([]);
  });
});

// =============================================================================
// commandFromCodexArguments — argument shape recovery
// =============================================================================

describe("commandFromCodexArguments", () => {
  it("returns a raw shell string unchanged", () => {
    expect(commandFromCodexArguments("trellis task create foo")).toBe(
      "trellis task create foo",
    );
  });

  it("extracts `cmd` from a stringified JSON object", () => {
    expect(
      commandFromCodexArguments(
        JSON.stringify({ cmd: "trellis task start bar" }),
      ),
    ).toBe("trellis task start bar");
  });

  it("extracts `command` from a stringified JSON object", () => {
    expect(
      commandFromCodexArguments(
        JSON.stringify({ command: "trellis task create baz" }),
      ),
    ).toBe("trellis task create baz");
  });

  it("joins `argv[]` with spaces from a stringified JSON object", () => {
    expect(
      commandFromCodexArguments(
        JSON.stringify({ argv: ["trellis", "task", "create", "qux"] }),
      ),
    ).toBe("trellis task create qux");
  });

  it("extracts `cmd` / `command` / `argv` from a raw object", () => {
    expect(commandFromCodexArguments({ cmd: "a" })).toBe("a");
    expect(commandFromCodexArguments({ command: "b" })).toBe("b");
    expect(commandFromCodexArguments({ argv: ["c", "d"] })).toBe("c d");
  });

  it("returns undefined for unrecognized shapes", () => {
    expect(commandFromCodexArguments(undefined)).toBeUndefined();
    expect(commandFromCodexArguments(42)).toBeUndefined();
    expect(commandFromCodexArguments({ other: "x" })).toBeUndefined();
    expect(commandFromCodexArguments("not json, no trellis task")).toBe(
      "not json, no trellis task",
    );
    expect(
      commandFromCodexArguments(JSON.stringify(["a", "b"])),
    ).toBeUndefined();
  });
});

// =============================================================================
// collectCodexTurnsAndEvents — raw rollout JSONL → turns + events
// =============================================================================

const CODEX_SESSIONS = nodePath.join(fakeHome, ".codex", "sessions");

describe("collectCodexTurnsAndEvents", () => {
  const sessionFile = nodePath.join(CODEX_SESSIONS, "rollout-test.jsonl");

  afterEach(() => {
    rimraf(CODEX_SESSIONS);
  });

  function buildSession(
    events: readonly Record<string, unknown>[],
  ): MemSessionInfo {
    writeJsonl(sessionFile, events);
    return { platform: "codex", id: "codex-test", filePath: sessionFile };
  }

  it("recognizes trellis task boundary from `argv[]` joined with spaces", () => {
    const s = buildSession([
      {
        timestamp: "2026-05-08T00:00:00Z",
        payload: { id: "codex-test", cwd: "/tmp/codex" },
      },
      {
        timestamp: "2026-05-08T00:00:01Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "brainstorm a task" }],
        },
      },
      {
        timestamp: "2026-05-08T00:00:02Z",
        payload: {
          type: "function_call",
          name: "shell",
          arguments: JSON.stringify({
            argv: ["trellis", "task", "create", "--slug", "codex-task"],
          }),
        },
      },
      {
        timestamp: "2026-05-08T00:00:03Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "go" }],
        },
      },
      {
        timestamp: "2026-05-08T00:00:04Z",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({
            argv: [
              "trellis",
              "task",
              "start",
              ".trellis/tasks/05-08-codex-task",
            ],
          }),
        },
      },
      {
        timestamp: "2026-05-08T00:00:05Z",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "implementing" }],
        },
      },
    ]);

    const { turns, events } = collectCodexTurnsAndEvents(s);
    expect(turns.length).toBe(3);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      action: "create",
      slug: "codex-task",
      turnIndex: 1,
    });
    expect(events[1]).toMatchObject({
      action: "start",
      taskDir: ".trellis/tasks/05-08-codex-task",
      turnIndex: 2,
    });

    const windows = buildBrainstormWindows(events, turns.length);
    expect(windows).toEqual([
      { label: "codex-task", startTurn: 1, endTurn: 2 },
    ]);
  });

  it("recognizes trellis task boundary from a raw `argv[]` object (not stringified)", () => {
    const s = buildSession([
      {
        timestamp: "2026-05-08T00:00:00Z",
        payload: { id: "codex-test", cwd: "/tmp/codex" },
      },
      {
        timestamp: "2026-05-08T00:00:01Z",
        payload: {
          type: "function_call",
          name: "shell",
          arguments: {
            argv: ["trellis task", "create", "--slug", "raw-obj"],
          },
        },
      },
    ]);
    const { events } = collectCodexTurnsAndEvents(s);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "create", slug: "raw-obj" });
  });

  it("still recognizes the raw-string `cmd` form", () => {
    const s = buildSession([
      {
        timestamp: "2026-05-08T00:00:00Z",
        payload: { id: "codex-test", cwd: "/tmp/codex" },
      },
      {
        timestamp: "2026-05-08T00:00:01Z",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: "trellis task create --slug str-cmd",
          }),
        },
      },
    ]);
    const { events } = collectCodexTurnsAndEvents(s);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "create", slug: "str-cmd" });
  });

  it("ignores non-trellis task function calls", () => {
    const s = buildSession([
      {
        timestamp: "2026-05-08T00:00:00Z",
        payload: { id: "codex-test", cwd: "/tmp/codex" },
      },
      {
        timestamp: "2026-05-08T00:00:01Z",
        payload: {
          type: "function_call",
          name: "shell",
          arguments: JSON.stringify({ argv: ["ls", "-la"] }),
        },
      },
    ]);
    expect(collectCodexTurnsAndEvents(s).events).toEqual([]);
  });
});

// =============================================================================
// collectPiTurnsAndEvents — raw Pi JSONL tree → turns + events
// =============================================================================

const PI_SESSIONS = nodePath.join(fakeHome, ".pi", "agent", "sessions");

describe("collectPiTurnsAndEvents", () => {
  const sessionFile = nodePath.join(
    PI_SESSIONS,
    "--tmp-pi-phase--",
    "session.jsonl",
  );

  afterEach(() => {
    rimraf(PI_SESSIONS);
  });

  function buildSession(
    events: readonly Record<string, unknown>[],
  ): MemSessionInfo {
    writeJsonl(sessionFile, events);
    return { platform: "pi", id: "pi-test", filePath: sessionFile };
  }

  it("captures trellis task boundaries from assistant toolCall blocks and bashExecution messages", () => {
    const s = buildSession([
      {
        type: "session",
        version: 3,
        id: "pi-test",
        timestamp: "2026-06-18T00:00:00.000Z",
        cwd: "/tmp/pi-phase",
      },
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: "2026-06-18T00:00:01.000Z",
        message: { role: "user", content: "brainstorm" },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-06-18T00:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "creating" },
            {
              type: "toolCall",
              name: "bash",
              arguments: {
                command: "trellis task create --slug pi-task",
              },
            },
          ],
        },
      },
      {
        type: "message",
        id: "u2",
        parentId: "a1",
        timestamp: "2026-06-18T00:00:03.000Z",
        message: { role: "user", content: "continue brainstorm" },
      },
      {
        type: "message",
        id: "b1",
        parentId: "u2",
        timestamp: "2026-06-18T00:00:04.000Z",
        message: {
          role: "bashExecution",
          command: "trellis task start .trellis/tasks/06-18-pi-task",
          output: "",
        },
      },
      {
        type: "message",
        id: "u3",
        parentId: "b1",
        timestamp: "2026-06-18T00:00:05.000Z",
        message: { role: "user", content: "implement" },
      },
    ]);

    const { turns, events } = collectPiTurnsAndEvents(s);
    expect(turns.map((t) => t.text)).toEqual([
      "brainstorm",
      "creating",
      "continue brainstorm",
      "implement",
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      action: "create",
      slug: "pi-task",
      turnIndex: 1,
    });
    expect(events[1]).toMatchObject({
      action: "start",
      taskDir: ".trellis/tasks/06-18-pi-task",
      turnIndex: 3,
    });
    expect(buildBrainstormWindows(events, turns.length)).toEqual([
      { label: "pi-task", startTurn: 1, endTurn: 3 },
    ]);
  });

  it("drops trellis task events from discarded pre-compaction history", () => {
    const s = buildSession([
      {
        type: "session",
        version: 3,
        id: "pi-test",
        timestamp: "2026-06-18T00:00:00.000Z",
        cwd: "/tmp/pi-phase",
      },
      {
        type: "message",
        id: "old",
        parentId: null,
        timestamp: "2026-06-18T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "old" },
            {
              type: "toolCall",
              name: "shell",
              arguments: { command: "trellis task create --slug stale" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "keep",
        parentId: "old",
        timestamp: "2026-06-18T00:00:02.000Z",
        message: { role: "user", content: "kept" },
      },
      {
        type: "compaction",
        id: "compact",
        parentId: "keep",
        timestamp: "2026-06-18T00:00:03.000Z",
        summary: "summary",
        firstKeptEntryId: "keep",
      },
    ]);

    const { turns, events } = collectPiTurnsAndEvents(s);
    expect(turns.map((t) => t.text)).toEqual([
      "[compact summary]\nsummary",
      "kept",
    ]);
    expect(events).toEqual([]);
  });
});
