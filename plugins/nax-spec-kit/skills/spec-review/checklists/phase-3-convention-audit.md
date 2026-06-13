# Phase 3 — Convention Audit

**Goal:** every code block in the spec respects the project's rule files.

**Blocker:** any forbidden pattern appears in a spec code block; any required pattern is missing where required.

## Step 1 — Load project rules

```bash
ls .nax/rules/ 2>/dev/null      # nax-native canonical store (higher priority)
ls .claude/rules/ 2>/dev/null   # Claude-specific layer
```

Read every `*.md` file under each directory that exists.

**Precedence — nax rules win.** `.nax/rules/` is the canonical, agent-neutral SSOT: per-agent shims (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) are generated one-way *from* it (`nax rules export`); `.claude/rules/` is a Claude-specific layer (a migration source for `.nax/rules/`, not a generated output). When both stores exist, apply this order (higher wins on conflict):

1. `.nax/rules/*.md` — **highest priority** (nax-native canonical store; path-scoped via `paths` / `appliesTo` / optional `priority` frontmatter)
2. `.claude/rules/*.md` — Claude-specific supplement; a directive here is overridden by a conflicting `.nax/rules/` one.

Common `.claude/rules/` files (mirrored or superseded by `.nax/rules/` in nax projects):
- `forbidden-patterns.md`
- `project-conventions.md`
- `retry-strategy.md`
- `adapter-wiring.md`
- `error-handling.md`
- `config-patterns.md`
- `monorepo-awareness.md`
- `testing-rules.md`
- `testing-commands.md`

If neither store exists, fall back to a minimal default set:
- No `JSON.parse` on LLM output (use a structured-parse SSOT)
- No hardcoded secrets
- No `console.log` in source code
- No `process.cwd()` outside CLI entry points

## Step 2 — Build the forbidden-pattern catalog

For each rule file, scan for:
- Tables under headings containing "Forbidden", "Banned", "Prohibited", "Anti-Pattern", "Never"
- Each row gives: `❌ pattern → ✅ alternative`

Build a search list:
```
{
  "JSON.parse(output)": "use parseLLMJson — SSOT for LLM output",
  "mock.module(": "use _deps injection",
  "console.log": "use logger",
  "process.cwd()": "use packageDir or ctx.workdir",
  "Bun.sleep": "OK in source; not in tests",
  "adapter.openSession": "use sessionManager (wiring layer only)",
  ...
}
```

## Step 3 — Build the required-pattern catalog

For each rule file, scan for sections like "MUST use X", "ALWAYS pass Y", "Required":

Examples:
- "Run-kind op with strict `parse()` and `op.retry` MUST declare `exhaustedFallback` or `op.recover`"
- "Every `logger.*` call in pipeline stages MUST include `storyId` as first key"
- "Permission decisions MUST go through `resolvePermissions(config, stage)`"
- "Test files MUST live under `test/unit/`, `test/integration/`, etc. — not in `test/` root"

## Step 4 — Scan spec code blocks against the catalog

Extract every code block from the spec. For each block:

**Forbidden-pattern check:**
```bash
# For each forbidden pattern, grep the spec content
grep -n "<forbidden-pattern>" <spec-path>
```

Each match is a finding. Severity depends on the rule:
- Hard "NEVER" / "MUST NOT" rules → **BLOCKER**
- Soft "avoid" / "prefer not" rules → **MAJOR**
- Style / "should" rules → **MINOR**

**Required-pattern check:**
- If the spec defines an op with `kind: "run"` + a strict throwing `parse()` + `retry`, check it has `exhaustedFallback` or `recover`
- If the spec defines a logger call inside what's clearly a pipeline stage, check `storyId` is the first key
- If the spec adds a new agent invocation site, check it goes through `callOp` (Layer 4) not adapter primitives

## Step 5 — Project-specific structural checks

Beyond pattern matching, verify structural conventions:

### Session role registry (nax-specific, generalizes to any role-registry codebase)

For every `session.role: "X"` in the spec:
```bash
grep -n "\"X\"" src/runtime/session-role.ts 2>/dev/null
```

If the role isn't in `KNOWN_SESSION_ROLES`, the spec must explicitly register it (story or design section).

### File location conventions

For each schema/type addition, verify location matches project convention:
- Zod schemas → `src/config/schemas-*.ts` (not always `schemas.ts`!)
- Prompt builders → `src/prompts/builders/`
- Operations → `src/operations/`
- Tests → `test/unit/`, `test/integration/`, never `test/` root

Mismatch is a **MAJOR** finding.

### Builder convention

If the spec proposes a function returning a multi-line LLM prompt, verify:
- It lives under `src/prompts/builders/` (or project equivalent)
- It's a class method, not a top-level function
- It's imported from the barrel, not the leaf path

## Step 6 — Op-shape conventions

For each `RunOperation` / `CompleteOperation` in the spec, check the codebase pattern:

```bash
grep -l "kind: \"run\"" src/operations/*.ts | head
grep -l "kind: \"complete\"" src/operations/*.ts | head
```

If the spec's op kind diverges from how every other LLM op in the codebase is defined (e.g. `kind: "complete"` for a single-turn op when all existing ones are `run`), flag as **MAJOR** with the convention citation.

## Finding template

```markdown
### Blocker — Forbidden pattern in spec code block

**Spec reference:** <section> line <N>
```typescript
<spec quote with the forbidden pattern>
```

**Rule violated:** [`<.nax|.claude>/rules/<file>.md`](.nax/rules/<file>.md) section "<heading>"
> <rule quote>

**Recommended fix:** Replace with `<alternative from rule>`.
```

## Common Phase 3 catches

- Bare `JSON.parse(output)` in op `parse()` — must be `parseLLMJson` per `forbidden-patterns.md`
- `kind: "complete"` for single-turn LLM op when codebase convention is `run`
- Op declares strict throwing `parse()` + `retry` but no `exhaustedFallback` — violates `retry-strategy.md`
- `transient-network` preset used for `ParseValidationError` retry — only fires on adapter failures, not parse errors
- Permission resolution hardcoded (`?? true`) instead of `resolvePermissions(config, stage)`
- `logger.*` call without `storyId` first key in pipeline-stage code
- Session role not in `KNOWN_SESSION_ROLES` registry
- Test file in `test/` root instead of `test/unit/`, `test/integration/`, etc.
- Prompt-building function outside `src/prompts/builders/`
- Direct `adapter.openSession` / `sendTurn` call from a pipeline stage
