/**
 * nax-spec-kit plugin for OpenCode.ai
 *
 * Registers the repo's skills directory with OpenCode so the spec-writing and
 * spec-review skills are discovered via OpenCode's native `skill` tool — no
 * symlinks or manual config edits required.
 *
 * Unlike superpowers, this plugin intentionally does NOT inject a bootstrap
 * system/user message: nax-spec-kit has no always-on "meta" skill. Both skills
 * activate on their own trigger phrases (e.g. "draft the spec", "review this
 * spec") or via the native `skill` tool.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const NaxSpecKitPlugin = async () => {
  // `.opencode/plugins/<file>` → repo-root `skills/`
  const skillsDir = path.resolve(__dirname, '../../skills');

  return {
    // Inject the skills path into live config so OpenCode discovers
    // nax-spec-kit skills without requiring manual symlinks or config edits.
    // Config.get() returns a cached singleton, so modifications here are
    // visible when skills are lazily discovered later.
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }
    },
  };
};
