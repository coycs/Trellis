import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import {
  resolvePlaceholders,
  resolveCommands,
  resolveSkills,
  resolveBundledSkills,
  writeSkills,
  writeAgents,
} from "./shared.js";
import { getAllAgents, getHooksConfig } from "../templates/cursor/index.js";

/**
 * Configure Cursor:
 * - commands/ — start + finish-work as slash commands (trellis- prefix, flat)
 * - skills/trellis-{name}/SKILL.md — auto-triggered skills from `common/skills/`
 * - agents/{name}.md — sub-agent definitions
 * - hooks.json — direct Trellis CLI hook commands
 * - hooks.json — hook configuration (separate file, not settings.json)
 */
export async function configureCursor(cwd: string): Promise<void> {
  const config = AI_TOOLS.cursor;
  const ctx = config.templateContext;
  const configRoot = path.join(cwd, config.configDir);

  const commandsDir = path.join(configRoot, "commands");
  ensureDir(commandsDir);
  for (const cmd of resolveCommands(ctx)) {
    await writeFile(
      path.join(commandsDir, `trellis-${cmd.name}.md`),
      cmd.content,
    );
  }

  await writeSkills(
    path.join(configRoot, "skills"),
    resolveSkills(ctx),
    resolveBundledSkills(ctx),
  );
  await writeAgents(path.join(configRoot, "agents"), getAllAgents());
  // Hooks config (separate file, not settings.json)
  await writeFile(
    path.join(configRoot, "hooks.json"),
    resolvePlaceholders(getHooksConfig()),
  );
}
