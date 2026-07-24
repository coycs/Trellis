import { describe, expect, it } from "vitest";
import {
  DIR_NAMES,
  FILE_NAMES,
  PATHS,
  getArchiveDir,
  getTaskDir,
} from "../../src/constants/paths.js";

describe("minimal Trellis paths", () => {
  it("keeps state under .trellis", () => {
    expect(DIR_NAMES.WORKFLOW).toBe(".trellis");
    expect(PATHS.TASKS).toBe(".trellis/tasks");
    expect(PATHS.SPEC).toBe(".trellis/spec");
    expect(PATHS.AGENTS).toBe(".trellis/agents");
    expect(PATHS.WORKFLOW_GUIDE_FILE).toBe(".trellis/workflow.md");
  });

  it("does not expose the removed runtime paths", () => {
    expect(DIR_NAMES).not.toHaveProperty("SCRIPTS");
    expect(PATHS).not.toHaveProperty("SCRIPTS");
    expect(FILE_NAMES).not.toHaveProperty("CURRENT_TASK");
    expect(FILE_NAMES).not.toHaveProperty("JOURNAL_PREFIX");
  });

  it("builds task and archive paths", () => {
    expect(getTaskDir("07-24-example")).toBe(".trellis/tasks/07-24-example");
    expect(getArchiveDir()).toBe(".trellis/tasks/archive");
  });
});
