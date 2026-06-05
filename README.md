# nax-spec-kit

A Claude Code plugin bundling two complementary skills for spec-driven development:

| Skill | Purpose |
|:------|:--------|
| **spec-writing** | Convert brainstorming output into a guide-conformant `SPEC-*.md`. Enforces sizing, behavioral (executable) verification anchors, seams, and terminal-cleanup isolation. |
| **spec-review** | Systematically audit an implementation spec against the actual codebase before handing it to implementers. Catches API hallucination, PRD↔code contradictions, convention violations, behavioral drift, sizing breaches, and stale references. |

They form a workflow pair:

```
brainstorming        → spec-writing             → spec-review        → plan
(intent exploration)   (intent → SPEC-*.md)       (codebase audit)     (decompose to PRD)
```

> **Note:** These skills are tuned for nax-style projects — they reference conventions such as `.claude/rules/`, ADR-009, and `nax plan`. They load `.claude/rules/` dynamically and degrade gracefully on other projects, but some guidance and examples assume the nax workflow.

## Installation

Installation differs by harness. If you use more than one, install nax-spec-kit
separately for each. All harnesses share the same `skills/` directory.

### Claude Code

This repo is its own plugin marketplace (`.claude-plugin/`). Add it, then install:

```bash
# From a local clone:
/plugin marketplace add /path/to/nax-spec-kit
/plugin install nax-spec-kit@nax-spec-kit

# Or, once pushed to GitHub:
/plugin marketplace add nathapp-io/nax-spec-kit-skills
/plugin install nax-spec-kit@nax-spec-kit
```

Restart or `/clear` the session after installing so the skills are discovered.

### Codex CLI

Manifest at `.codex-plugin/plugin.json`. Install via Codex's plugin interface
(`/plugins` → search/add this repo), or point Codex at a local checkout.

### Cursor

Manifest at `.cursor-plugin/plugin.json`. Install via Cursor's plugin manager
pointing at this repo or a local clone.

### OpenCode

Manifest + entry at `.opencode/`. See [.opencode/INSTALL.md](./.opencode/INSTALL.md).
Quick version — add to your `opencode.json`:

```json
{
  "plugin": ["nax-spec-kit@git+https://github.com/nathapp-io/nax-spec-kit-skills.git"]
}
```

## Usage

Both skills auto-activate on trigger phrases, or invoke them explicitly:

```
/spec-writing <source>     # draft a SPEC-*.md from a brainstorm/source
/spec-review <path>         # audit a spec against the codebase
/spec-review --spec <spec.md> --prd <prd.json>   # also verify spec→PRD fidelity
```

You can also just say "draft the spec for X" or "review this spec against the codebase".

## Layout

```
.claude-plugin/
  plugin.json        # Claude Code plugin manifest
  marketplace.json   # self-hosted marketplace entry
.codex-plugin/
  plugin.json        # Codex CLI manifest (skills → ../skills/)
.cursor-plugin/
  plugin.json        # Cursor manifest (skills → ../skills/)
.opencode/
  plugins/nax-spec-kit.js   # OpenCode plugin: registers ../../skills
  INSTALL.md
package.json         # OpenCode git-backed install entry (main)
skills/
  spec-writing/
    SKILL.md
    reference/spec-writing-guide.md
  spec-review/
    SKILL.md
    checklists/       # 6 phase checklists
    examples/
```

## License

MIT — see [LICENSE](./LICENSE).
