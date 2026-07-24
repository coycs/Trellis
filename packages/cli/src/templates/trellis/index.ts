/**
 * Trellis workflow templates
 *
 * These are GENERIC templates for user projects.
 * Do NOT use Trellis project's own .trellis/ directory (which may be customized).
 *
 * Directory structure:
 *   trellis/
 *   ├── agents/                # Channel runtime agent definitions
 *   │   └── *.md               # Loaded by `trellis channel spawn --agent <name>`
 *   ├── workflow.md           # Workflow guide
 *   ├── config.yaml            # Trellis configuration
 *   └── gitignore.txt         # .gitignore content
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readTemplate(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), "utf-8");
}

// Configuration files
export const workflowMdTemplate = readTemplate("workflow.md");
export const configYamlTemplate = readTemplate("config.yaml");
export const gitignoreTemplate = readTemplate("gitignore.txt");
export const removedTemplates = [
  ".trellis/scripts",
  ".claude/hooks/session-start.py",
  ".claude/hooks/inject-workflow-state.py",
  ".claude/hooks/inject-subagent-context.py",
  ".claude/hooks/statusline.py",
  ".codex/hooks/session-start.py",
  ".codex/hooks/inject-workflow-state.py",
  ".codex/hooks/inject-subagent-context.py",
  ".cursor/hooks/session-start.py",
  ".cursor/hooks/inject-subagent-context.py",
  ".cursor/hooks/inject-shell-session-context.py",
  ".gemini/hooks/session-start.py",
  ".gemini/hooks/inject-workflow-state.py",
  ".qoder/hooks/session-start.py",
  ".qoder/hooks/inject-workflow-state.py",
  ".codebuddy/hooks/session-start.py",
  ".codebuddy/hooks/inject-workflow-state.py",
  ".codebuddy/hooks/inject-subagent-context.py",
  ".factory/hooks/session-start.py",
  ".factory/hooks/inject-workflow-state.py",
  ".factory/hooks/inject-subagent-context.py",
  ".github/copilot/hooks/session-start.py",
  ".github/copilot/hooks/inject-workflow-state.py",
  ".kiro/hooks/session-start.py",
  ".kiro/hooks/inject-workflow-state.py",
  ".kiro/hooks/inject-subagent-context.py",
  ".trae/hooks/session-start.py",
  ".trae/hooks/inject-workflow-state.py",
  ".zcode/hooks/session-start.py",
  ".zcode/hooks/inject-workflow-state.py",
  ".zcode/hooks/inject-subagent-context.py",
  ".snow/hooks/write-trellis-context.py",
  ".claude/skills/trellis-meta/references/claude-code/agents.md",
  ".claude/skills/trellis-meta/references/claude-code/hooks.md",
  ".claude/skills/trellis-meta/references/claude-code/multi-session.md",
  ".claude/skills/trellis-meta/references/claude-code/overview.md",
  ".claude/skills/trellis-meta/references/claude-code/ralph-loop.md",
  ".claude/skills/trellis-meta/references/claude-code/scripts.md",
  ".claude/skills/trellis-meta/references/claude-code/worktree-config.md",
  ".claude/skills/trellis-meta/references/core/files.md",
  ".claude/skills/trellis-meta/references/core/overview.md",
  ".claude/skills/trellis-meta/references/core/scripts.md",
  ".claude/skills/trellis-meta/references/core/specs.md",
  ".claude/skills/trellis-meta/references/core/tasks.md",
  ".claude/skills/trellis-meta/references/core/workspace.md",
  ".claude/skills/trellis-meta/references/how-to-modify/add-agent.md",
  ".claude/skills/trellis-meta/references/how-to-modify/add-command.md",
  ".claude/skills/trellis-meta/references/how-to-modify/add-phase.md",
  ".claude/skills/trellis-meta/references/how-to-modify/add-spec.md",
  ".claude/skills/trellis-meta/references/how-to-modify/change-verify.md",
  ".claude/skills/trellis-meta/references/how-to-modify/modify-hook.md",
  ".claude/skills/trellis-meta/references/how-to-modify/overview.md",
  ".claude/skills/trellis-meta/references/meta/platform-compatibility.md",
  ".claude/skills/trellis-meta/references/meta/self-iteration-guide.md",
  ".claude/skills/trellis-meta/references/meta/trellis-local-template.md",
] as const;

// Channel runtime agent definitions (loaded by
// `packages/cli/src/commands/channel/agent-loader.ts` from `.trellis/agents/`).
// These are platform-agnostic Trellis runtime files dispatched at `trellis init`
// and refreshed by `trellis update`.
export const implementAgentTemplate = readTemplate("agents/implement.md");
export const checkAgentTemplate = readTemplate("agents/check.md");

/**
 * Get all channel runtime agent definitions as a map of relative path
 * (under `.trellis/agents/`) to content.
 *
 * Consumed by `trellis init` (to dispatch on first install) and by
 * `trellis update` (to backfill missing files and surface conflicts on edited
 * ones via the standard hash machinery).
 */
export function getAllAgents(): Map<string, string> {
  const agents = new Map<string, string>();
  agents.set("implement.md", implementAgentTemplate);
  agents.set("check.md", checkAgentTemplate);
  return agents;
}
