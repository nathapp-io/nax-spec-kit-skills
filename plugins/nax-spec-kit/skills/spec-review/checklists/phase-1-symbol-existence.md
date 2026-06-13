# Phase 1 — Symbol Existence Audit

**Goal:** every named symbol in the spec is either present in the codebase OR explicitly listed as a new artifact in the spec's "Remaining work" / "New code" table.

**Blocker:** any symbol that exists in neither.

## Step 1 — Build the new-work allowlist

Read the spec. Find the section titled "Remaining work", "New code", "New files", "Implementation Surface", or "Files to create". Extract every file path / symbol listed there.

This is the **allowlist** — symbols the spec is creating from scratch. These should NOT be present in the codebase; if they are, that's a Phase 6 stale-reference finding (different defect).

## Step 2 — Extract symbols from the spec body

Scan every backtick-quoted identifier and every code block. Categorize:

| Symbol type | Pattern | Examples |
|:---|:---|:---|
| File path | contains `/` + extension | `src/agents/retry/types.ts`, `test/unit/foo.test.ts` |
| Function | `name(` or `name()` | `validatePlanOutput()`, `extractClaims()` |
| Method on object | `obj.method(` | `agentManager.completeAs()`, `ctx.lastOutput` |
| Type / interface | UpperCamelCase, no parens | `RetryContext`, `PlanConfig`, `VerifierFinding` |
| Constant | `ALL_CAPS` or `kebab-case` literals | `FAIL_OPEN`, `DEFAULT_CITATION_THRESHOLD` |
| Config key | dotted path | `config.plan.mode`, `config.debate.grounder.model` |
| Enum value | string literal in TypeScript-style union | `"single" \| "debate" \| "pipeline"` |

## Step 3 — Verify each symbol

For each extracted symbol NOT in the allowlist, run:

```bash
grep -rn "<symbol>" src/ test/ 2>/dev/null | head -5
```

For file paths, additionally:
```bash
ls -la <path> 2>&1
```

For config keys, check the schema files:
```bash
grep -n "<key>" src/config/schemas*.ts 2>/dev/null
```

For method calls on objects, verify the object's type and check that method exists:
```bash
grep -n "<method>" src/**/types.ts 2>/dev/null
```

## Step 4 — Cross-reference and classify

For each symbol, exactly one of:

| Outcome | Action |
|:---|:---|
| Exists in codebase | ✅ pass — record location for use in later phases |
| Exists in allowlist (new-work table) | ✅ pass — forward reference, OK |
| Exists in neither | ❌ **BLOCKER** — generate finding |
| Exists in BOTH codebase and allowlist | ⚠️ **MAJOR** — spec proposes creating something that already exists; likely revision artifact (also flag in Phase 6) |

## Step 5 — Special cases

### TypeScript context-object field access (`ctx.foo`)

When the spec references `ctx.fieldName`, verify the field is on the actual context type. Common failures:
- `ctx.lastInput` — does it exist on `RetryContext`?
- `ctx.runtime.signal` — does the runtime carry a signal?
- `ctx.storyId` — required vs optional?

Open the relevant `interface XxxContext` definition and diff.

### Re-exports and barrel paths

If the spec imports `from "../config"` and the symbol is actually defined in `"../config/internal/foo"`, that's OK provided the barrel re-exports it. Verify:
```bash
grep "^export" src/<barrel-dir>/index.ts | grep "<symbol>"
```

### Path aliases

Specs may use `@/` aliases per `tsconfig.json`. Resolve before grepping:
- `@/foo/bar` → `src/foo/bar`
- `@test/foo` → `test/foo`

## Step 6 — Forward-reference allowlist

After Phase 1 completes, record the allowlist as JSON for use by later phases:

```json
{
  "newFiles": ["src/operations/plan-draft.ts", "src/operations/plan-critic-llm.ts", ...],
  "newSymbols": ["planDraftOp", "planCriticLlmOp", "PlanDraftInput", ...],
  "modifiedFiles": ["src/cli/plan.ts", "src/config/schemas-infra.ts", ...]
}
```

Phase 2 uses `modifiedFiles` to know which type definitions are about to grow; Phase 6 uses `newSymbols` to verify they're NOT already present.

## Finding template

```markdown
### Blocker — `<symbol>` not found in codebase or new-work table

**Spec reference:** <section> line <N> (`<spec-quote>`)
**Codebase reality:** `grep -rn "<symbol>" src/` returned 0 matches; not listed in spec's "<remaining-work-section-name>" table
**Recommended fix:** <one of: add to new-work table OR remove from spec OR correct the name>
```

## Common Phase 1 catches

- `ctx.lastInput` — not on `RetryContext` ([src/agents/retry/types.ts:9-16](../../src/agents/retry/types.ts))
- Constants referenced before being defined in the spec itself (`FAIL_OPEN_DRAFT` mentioned in AC before being defined in Design)
- Interface fields used in code blocks but missing from the interface definition (`PlanDraftInput.revisionFindings`)
- Wrong barrel path (`from "../config/schemas"` when symbol lives in `../config/schemas-infra`)
- Session roles not in `KNOWN_SESSION_ROLES` registry
