# Phase 2 — Shape Audit

**Goal:** every claim about an interface/type/function shape matches what's actually defined.

**Blocker:** structural claim contradicted by code.

## Prerequisite

Phase 1 must have completed. Use its forward-reference allowlist — symbols being newly created in the spec should NOT be shape-checked against the codebase (they don't exist yet).

## Step 1 — Extract structural claims from the spec

Scan for these patterns:

| Pattern | Example | What to verify |
|:---|:---|:---|
| Interface usage in code blocks | `interface PlanDraftInput { ... }` | Field set matches actual definition |
| Type assertion / cast | `ctx.lastInput as PlanDraftInput` | Source field exists on its parent type |
| Method invocation | `agentManager.completeAs(...)` | Method exists with that signature |
| Schema field | `mode: z.enum([...]).default(X)` | Existing schema has compatible shape |
| Discriminated union usage | `selector: { kind: "verifier-pick", patch: {...} }` | Union member exists; field set matches |
| Enum literal | `severity: "blocker" \| "major" \| "minor"` | Enum members match actual definition |
| Function signature in design | `function fooBar(x: A, y: B): C` | Real signature matches |
| Property access chain | `ctx.runtime.runId` | Each link in the chain exists |

## Step 2 — Locate the actual definition

For each claim, open the source. Common locations:
- Types: `*/types.ts` near the consumer
- Schemas: `src/config/schemas*.ts`
- Interfaces: same file as the export, often near the top
- Registries: `src/runtime/`, `src/agents/`

## Step 3 — Field-by-field diff

For each interface/type, compare:

| Aspect | Spec says | Code says | Outcome |
|:---|:---|:---|:---|
| Field present | yes | no | **BLOCKER** |
| Field present | no | yes | minor — likely irrelevant in spec |
| Optionality | `?:` (optional) | `:` (required) | **MAJOR** — runtime null/undefined |
| Type | `string` | `string \| null` | **MAJOR** — type mismatch |
| Default | `.default("fast")` | `.default("balanced")` | **MAJOR** — behavior change |
| Default | `.default(X)` | `.optional()` | **MAJOR** — different fallback semantics |
| Enum members | superset of code | subset of code | **MAJOR** — runtime ZodError |

## Step 4 — Function signature checks

For each function call in the spec, locate the actual signature:

```bash
grep -n "export function <name>\|export const <name>" src/ -r
```

Compare:
- Parameter count
- Parameter order
- Parameter types (especially optional vs required positional)
- Return type (Promise<T> vs T)
- Generic parameters

## Step 5 — Method-on-context checks (high-defect-rate)

These are the most common source of hallucination. For any `ctx.foo.bar()` in the spec:

1. Find the type of `ctx` (look at the surrounding function signature)
2. Open the type definition
3. Verify `foo` is a member
4. Verify `bar` is a method/field on `foo`'s type

Common context types to scrutinize:
- `RetryContext` (often hallucinated — `lastInput`, `lastError`, `attemptKind`)
- `CallContext` (often hallucinated — `config`, `dispatcher`)
- `BuildContext<C>` (often hallucinated — `agentName`, `dispatchAgent`)
- `HopBodyContext<I>` (often hallucinated — `signal`, `input`)

## Step 6 — Schema additions

When the spec proposes adding fields to an existing schema, verify:

1. **Field doesn't already exist** — if it does, this is a Phase 6 stale reference, not a Phase 2 addition
2. **Type alignment with existing siblings** — e.g. if other model fields are `ConfiguredModelSchema`, the new field should be too
3. **Defaults make sense** — `.optional()` requires runtime resolver, `.default(X)` doesn't
4. **Location matches project convention** — schemas-infra.ts vs schemas.ts vs schemas-debate.ts

## Finding template

```markdown
### Blocker — `<type>.<field>` proposed in spec contradicts actual definition

**Spec reference:** <section> line <N>
```
<spec quote>
```

**Codebase reality:** [`<file>:<line>`](<file>#L<line>)
```
<code quote>
```

**Mismatch:** <one-sentence summary — e.g. "spec proposes acceptanceCriteria as Array<{ text, verifiedBy }>; actual definition is string[]">

**Recommended fix:** <how to resolve — usually one of: revise spec to match code OR escalate the type change as a separate breaking-schema RFC>
```

## Common Phase 2 catches

- Per-AC structured `verifiedBy` when `acceptanceCriteria: string[]` (top defect from real review)
- `criticModel: optional()` when default should be `default("fast")`
- `ctx.lastInput as TInput` when `RetryContext` has no `lastInput` field
- `transient-network` retry preset when parse failures need `makeParseRetryStrategy`
- `kind: "complete"` when single-turn LLM ops in the codebase are all `kind: "run"`
- Field used in ACs but absent from the interface definition (`revisionFindings`)
- Wrong schema file location (proposes editing `schemas.ts` when the type lives in `schemas-infra.ts`)
