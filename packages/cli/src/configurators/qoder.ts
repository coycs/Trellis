import path from "node:path";
import { AI_TOOLS } from "../types/ai-tools.js";
import { ensureDir, writeFile } from "../utils/file-writer.js";
import {
  resolvePlaceholders,
  resolveCommands,
  resolveSkills,
  resolveBundledSkills,
  wrapWithCommandFrontmatter,
  writeSkills,
  writeAgents,
  applyPullBasedPreludeMarkdown,
} from "./shared.js";
import { getAllAgents, getSettingsTemplate } from "../templates/qoder/index.js";

/**
 * Configure Qoder (pull-based class-2 platform).
 *
 * Qoder Custom Commands require YAML frontmatter with `name` + `description`
 * and use a flat layout, so session-boundary commands get wrapped via
 * `wrapWithCommandFrontmatter`; auto-trigger workflows stay as plain skills.
 * Sub-agent context is pull-based because Qoder's hook can't inject
 * sub-agent prompts — sub-agents pull task context themselves.
 */
export async function configureQoder(cwd: string): Promise<void> {
  const config = AI_TOOLS.qoder;
  const ctx = config.templateContext;
  const configRoot = path.join(cwd, config.configDir);

  const commandsDir = path.join(configRoot, "commands");
  ensureDir(commandsDir);
  for (const cmd of resolveCommands(ctx)) {
    const name = `trellis-${cmd.name}`;
    await writeFile(
      path.join(commandsDir, `${name}.md`),
      wrapWithCommandFrontmatter(name, cmd.content),
    );
  }

  await writeSkills(
    path.join(configRoot, "skills"),
    resolveSkills(ctx),
    resolveBundledSkills(ctx),
  );
  await writeAgents(
    path.join(configRoot, "agents"),
    applyPullBasedPreludeMarkdown(getAllAgents()),
  );
  const settings = getSettingsTemplate();
  await writeFile(
    path.join(configRoot, settings.targetPath),
    resolvePlaceholders(settings.content),
  );
}
