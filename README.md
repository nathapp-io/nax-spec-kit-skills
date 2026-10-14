# nax-spec-kit

A Claude Code plugin bundling two complementary skills for spec-driven development:

| Skill | Purpose |
|:------|:--------|
| **spec-writing** | Convert brainstorming output into a guide-conformant `SPEC-*.md`. Enforces sizing, behavioral (executable) verification anchors, seams, and terminal-cleanup isolation. Gates the draft through `nax spec lint` before handoff. |
| **spec-review** | Systematically audit an implementation spec against the actual codebase before handing it to implementers. Catches API hallucination, PRD↔code contradictions, existing-test contract collisions, convention violations, behavioral drift, sizing breaches, and stale references. |

They form a workflow pair:

```
brainstorming        → spec-writing         → nax spec lint            → spec-review      → plan
(intent exploration)   (intent → SPEC-*.md)   (machine-extraction gate)  (codebase audit)   (decompose to PRD)
```

`nax spec lint` runs inside spec-writing Phase 6, immediately before the
spec-review handoff. It checks that the draft's machine-extracted sections
(`### Modifies`, `### Context Files`, `## Out of Scope`) actually extract — they
fail silently otherwise — and exits non-zero exactly when `nax plan` would refuse
the spec. On a host with no `nax` on PATH the stage is skipped and the skip is
noted in the report.

> **Note:** These skills are tuned for nax-style projects — they reference conventions such as `.nax/rules/`, `.claude/rules/`, ADR-009, and `nax plan`. They load the project's rule store(s) dynamically — `.nax/rules/` (nax-native canonical store, higher priority) and `.claude/rules/` — and degrade gracefully on other projects, but some guidance and examples assume the nax workflow.

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

This repo is also a Codex marketplace. Add it, then install:

```bash
# From a local clone:
codex plugin marketplace add /path/to/nax-spec-kit-skills
codex plugin add nax-spec-kit@nax-spec-kit

# Or, once pushed to GitHub:
codex plugin marketplace add nathapp-io/nax-spec-kit-skills
codex plugin add nax-spec-kit@nax-spec-kit
```

The marketplace entry lives at `.agents/plugins/marketplace.json`, and the
installable Codex plugin lives at `plugins/nax-spec-kit/`. In a Codex thread,
invoke it explicitly with `@nax-spec-kit ...` or just describe the task — the
bundled skills (`spec-writing`, `spec-review`) auto-activate on their trigger
phrases.

**Maintaining the Codex skill payload**

Edit only the canonical root `skills/` tree. The marketplace payload under
`plugins/nax-spec-kit/skills/` is generated release content for Codex (a real
directory, not a symlink — Codex installs don't follow symlinks).

```bash
npm run sync:codex-skills      # rebuild packaged Codex skills from skills/
npm run verify:codex-skills    # fail if packaged skills drift from skills/
npm run prepare:codex-release  # sync + verify + marketplace verification
```

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
.agents/plugins/
  marketplace.json   # Codex marketplace entry for this repo
.codex-plugin/
  plugin.json        # Optional repo-root Codex manifest for direct local testing
plugins/nax-spec-kit/
  .codex-plugin/plugin.json   # Marketplace-installed Codex plugin
  skills/                     # Real skill payload included in install root
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

## Fixture corpus (mechanical checks)

`fixtures/` holds minimal invented specs — defect fixtures isolate a documented
**mechanical** finding; clean controls may fire nothing. Optional `prd.json` files
exercise dependency fidelity after planning. `npm run
test:fixtures` (chained last in `prepare:codex-release`; this repo has no CI, so
the gate runs when that chain runs) executes `scripts/eval-mechanical.mjs`,
which mirrors documented mechanical checks for the fixture shapes — a fixture fails when its
expected check does not fire, or when anything unexpected fires, on any fixture.

Coverage today includes **ten mechanical checks** (Step 8b Out-of-Scope shape,
Step 9b placeholder sentinels, Phase 7 banned tags, the marker-placement rule,
the Modifies one-file-per-bullet rule, Step 7b no `Creates`/`Modifies` entry under
`.nax/`, plus missing/conflicting story dependency declarations, invalid `Closes:`
tokens, and spec-to-PRD dependency sets). The declaration reader covers canonical
fixture shapes; it does not replace nax's parser or a full spec review. This is
not the whole mechanical surface (AC caps, duplicate ACs, required sections,
and other Phase 6 shell sweeps are not yet fixtured). **Ratchet:** a PR that adds or edits a mechanical check ships or
updates its fixture in the same PR; the runner's header comment maps each check
to its documentation SSOT. Judgment checks (Phase 4's `P4.n`, Step 8c, seam
tracing, issue-closure intent, and whether Out of Scope contradicts closure) need an LLM reviewer and are deliberately out of this corpus's scope.

## License

MIT — see [LICENSE](./LICENSE).

### OpenCode version compatibility

OpenCode **2.0.4+** uses the `plugins` key and the root `index.js` directory entry.
OpenCode **1.x** retains the named plugin export and config hook. See
[OpenCode installation](.opencode/INSTALL.md) for examples, including older V1
releases. Run `npm run test:opencode` to check both API contracts.
