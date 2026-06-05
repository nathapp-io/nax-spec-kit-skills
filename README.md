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

## Installation (Claude Code)

This repo is its own plugin marketplace. Add it, then install the plugin:

```bash
# From a local clone:
/plugin marketplace add /path/to/nax-spec-kit
/plugin install nax-spec-kit@nax-spec-kit

# Or, once pushed to GitHub:
/plugin marketplace add <github-user>/nax-spec-kit
/plugin install nax-spec-kit@nax-spec-kit
```

Restart or `/clear` the session after installing so the skills are discovered.

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
  plugin.json        # plugin manifest
  marketplace.json   # self-hosted marketplace entry
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
