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
| **Data literal** | quoted filename, URL, or magic string that is **not** a code symbol | `constituents-dowjones.csv`, `https://api.example.com/v3/quote`, `"SPY"` |

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

### Data literals need a different lookup

A filename or URL the feature *consumes* is not a code symbol, so the `src/ test/`
grep above will legitimately return nothing and prove nothing. Every data literal
must instead trace to one of:

| Trace target | How to check |
|:---|:---|
| A fixture already in the repo | locate the repo's fixture/testdata dirs first — the name varies (`fixtures/`, `testdata/`, `tests/data/`, or alongside the tests) — then `grep -rn "<literal>" <those dirs> test/ 2>/dev/null` |
| A documented external source | the literal appears in the spec's own source/provenance section, a README, or a config default |
| Explicitly new | listed in the spec's "Remaining work" / "New code" table, same as any other new artifact |

If a literal traces to none of the three, it is unverifiable prose asserting a fact
about the world. Flag it. Do **not** try to fetch a remote URL to settle it — the
finding is that the spec never said where the value came from, and that is true
whether or not the endpoint happens to resolve today.

**Scope this tightly — the check is only worth its noise if it stays narrow.** A
data literal is one the feature *reads from the world*: a source filename, an
endpoint, a dataset or instrument identifier. It is **not**:

- an illustrative value in an example block (`// e.g. "foo"`) — nothing depends on it
- a string the feature *produces* (an error message, a log line, an output filename) — the spec defines it, so there is nothing to trace
- an enum value or config key — already covered by the rows above

If getting the value wrong would make a correct implementation fail its AC, it is in
scope. Otherwise skip it.

## Step 4 — Cross-reference and classify

For each symbol, exactly one of:

| Outcome | Action |
|:---|:---|
| Exists in codebase | ✅ pass — record location for use in later phases |
| Exists in allowlist (new-work table) | ✅ pass — forward reference, OK |
| Exists in neither | ❌ **BLOCKER** — generate finding |
| Exists in BOTH codebase and allowlist | ⚠️ **MAJOR** — spec proposes creating something that already exists; likely revision artifact (also flag in Phase 6) |
| Data literal traces to no fixture, no documented source, and no new-work entry | ❌ **BLOCKER** — the AC cannot be satisfied or refuted without guessing |

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

### Symbol not found

```markdown
### Blocker — `<symbol>` not found in codebase or new-work table

**Spec reference:** <section> line <N> (`<spec-quote>`)
**Codebase reality:** `grep -rn "<symbol>" src/` returned 0 matches; not listed in spec's "<remaining-work-section-name>" table
**Recommended fix:** <one of: add to new-work table OR remove from spec OR correct the name>
```

### Data literal with no traceable source

```markdown
### Blocker — data literal `<literal>` has no traceable source

**Spec reference:** <section> line <N> (`<spec-quote>`)
**Codebase reality:** not present in any fixture (`grep -rn "<literal>" <fixture-dirs> test/` → 0 matches); the spec names no source for it; not listed in "<remaining-work-section-name>"
**Why this blocks:** the implementer must invent the value and the reviewer cannot check it. If the guess is wrong, the implementation is correct and the AC is not — which presents as reviewer oscillation rather than as a spec defect.
**Recommended fix:** <one of: cite the source that defines it | add the fixture to the new-work table | replace the literal with the real value>
```

## Common Phase 1 catches

- `ctx.lastInput` — not on `RetryContext` ([src/agents/retry/types.ts:9-16](../../src/agents/retry/types.ts))
- Constants referenced before being defined in the spec itself (`FAIL_OPEN_DRAFT` mentioned in AC before being defined in Design)
- Interface fields used in code blocks but missing from the interface definition (`PlanDraftInput.revisionFindings`)
- Wrong barrel path (`from "../config/schemas"` when symbol lives in `../config/schemas-infra`)
- Session roles not in `KNOWN_SESSION_ROLES` registry
- A stale external filename — an AC pinned `constituents-dow.csv` where the real remote artifact is `constituents-dowjones.csv`. The implementation was right, the AC was wrong, and the generated test mocked the wrong URL, so both reviewers had grounds to keep failing the story
