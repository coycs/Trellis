/**
 * Kiro templates
 *
 * Kiro uses pure JSON agent definitions, not Markdown.
 * CLI agents embed hooks in their JSON (`hooks.agentSpawn`,
 * `hooks.userPromptSubmit`); the IDE surface reads standalone `.kiro.hook`
 * JSON files (`when`/`then` schema).
 *
 * Directory structure:
 *   kiro/
 *   ├── agents/      # Agent definitions (JSON) — main `trellis` + 3 sub-agents
 *   └── hooks/       # IDE `.kiro.hook` definitions (JSON)
 */

import { createTemplateReader, type AgentTemplate } from "../template-utils.js";
export type { AgentTemplate };

const { listFiles, readTemplate, listJsonAgents } = createTemplateReader(
  import.meta.url,
);

/**
 * Get all Kiro agent templates (JSON format).
 */
export const getAllAgents = (): AgentTemplate[] => listJsonAgents();

export interface IdeHookTemplate {
  /** Filename (e.g. "trellis-workflow-state.kiro.hook") */
  name: string;
  /** Raw JSON content. */
  content: string;
}

/**
 * Get all Kiro IDE hook templates (`*.kiro.hook` JSON files).
 */
export const getIdeHooks = (): IdeHookTemplate[] =>
  listFiles("hooks")
    .filter((f) => f.endsWith(".kiro.hook"))
    .map((f) => ({ name: f, content: readTemplate(`hooks/${f}`) }));
