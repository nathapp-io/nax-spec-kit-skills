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

Every addition that reaches this step is also a mutation of an existing shape, so
carry it into Step 7 — the same trigger, asked against the test tree instead of the
definition.

## Step 7 — Existing-test contract collision (closed-world assertions)

Steps 1-6 ask whether the spec's claims match the code. This step asks the inverse:
when the spec **mutates a shape that already exists**, does an *existing test* pin
that shape in a way the mutation necessarily breaks?

Trigger on any spec change that adds, removes, or renames a member of an existing
shared shape:

- a column on an existing table, or a field on an existing model / DTO / record
- a member of an existing enum, union, or literal set
- an entry in an existing registry, error-code list, route table, or config schema
- a parameter on an existing exported signature
- a key in an existing serialized payload (API response, event, persisted document)

For each mutation, sweep the test tree for assertions that name the shape:

```bash
# language-neutral — <shape> is the table / type / enum / registry name
grep -rn "<shape>" <test roots> | head -40
```

Classify each hit. Only **closed-world** assertions — ones that break on any new
member — are findings:

| Assertion form | Example | Verdict |
|:---|:---|:---|
| Set / collection equality | `assert actual_columns == expected_columns` | closed |
| Exact object equality | `expect(payload).toEqual({...})`, `assert.DeepEqual(got, want)` | closed |
| Exact count | `assert len(fields) == 15`, `expect(keys).toHaveLength(15)` | closed |
| Golden / snapshot | `toMatchSnapshot()`, checked-in `*.golden`, approved JSON | closed |
| Exhaustive case list | test asserting a switch/match handles exactly N variants | closed |
| Loop over **actual** members | `for col in table.columns: assert expected[col.name] ...` | closed |
| Membership / superset | `assert "id" in cols`, `expect(obj).toMatchObject({...})` | open — ignore |
| Loop over **expected** members | `for name, t in expected.items(): assert cols[name] ...` | open — ignore |

**The two loop rows are the same test with its iteration order swapped, and only one
is safe.** A loop driven by the *actual* member set looks per-member — one property of
one member at a time, never a total — but indexing the expected map with a member it has
never heard of fails on the first addition. It is closed-world with the closure hidden in
a lookup, so it fails as a `KeyError` / `undefined` / missing-key panic, not an assertion
diff: grepping `assert ... ==` will not surface it. Read the loop header — *what does it
iterate?* — not the assertion in the body.

Expect it **behind** an exact-set assertion in the same test, since a test that pins the
member set usually goes on to check each member's type. Fixing only the obvious
assertion turns one red test into the same red test with a different error, so sweep the
whole test body before closing the finding.

A closed-world hit is a **blocker** unless the spec **authorises the implementer to edit
that test file** — an AC covering the update, or a `Modifies` / `Context Files` entry
naming it. Authorisation is the bar because permission is what the implementer lacks;
anything short of it leaves the gate red with no legal move.

An `## Out of Scope` line does **not** clear it: deferring the test update does not stop
the assertion failing, it only makes the failure expected. Downgrade to **major** solely
when the spec also establishes the collision cannot fire during the run — the mutation is
inert at test time (behind a flag the run never sets), or an earlier in-scope story
deletes or rewrites the pinning test. Otherwise the deferral is a documented deadlock.

**Why blocker, not minor.** The implementation will be *correct* and the story will still
fail terminally: the full-suite gate runs the whole existing suite, and test-authorship
isolation (`tdd.testWriterAllowedPaths`, `autofix.enforceTestWriterIsolation`, or any
harness equivalent) bars implementer and rectifier from editing a test the story does not
own. The rectifier can only revert its own correct work or stop — observed behaviour is
`agent-gave-up` after exhausting every escalation tier. No implementation-only change
satisfies both contracts, so retry, escalation, and a stronger model all fail alike.

**Recommended fix** — one of, in preference order:

1. Add an AC to the mutating story that updates the stale assertion, and list the
   test file under that story's `Modifies` / `Context Files` so the implementer is
   permitted to touch it.
2. Relax the assertion to open-world in a preparatory story ordered before the
   mutation — a superset check plus a loop over the *expected* members preserves
   the original intent without the trap. Name both rewrites in the AC; an AC that
   says only "relax the column-set assertion" leaves the type loop behind it
   untouched and the gate still red.
3. Reorder so the story that owns the pinning test retires or rewrites it before the
   mutating story runs. Only this and option 1 actually clear the gate.

**Cross-story variant.** The collision is not only with already-shipped tests. If a
story in *this* spec writes a closed-world assertion over a shape a later story
extends, the same deadlock occurs mid-run — and the later story is the one that
fails. Read the spec's own ACs for closed-world wording (`exactly`, `only these`,
`and no others`, an explicit count) over any shape a downstream story touches.

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

### Blocker — existing test pins `<shape>` exhaustively; this spec extends it

```markdown
**Spec reference:** <story / section> line <N> — adds `<member>` to `<shape>`

**Codebase reality:** [`<test file>:<line>`](<test file>#L<line>) — <the closed-world assertion>

**Collision:** the assertion is <set-equality / exact-count / snapshot> over
`<shape>`'s members, so adding `<member>` fails it. No story in this spec authorises
editing `<test file>`, and test-authorship isolation bars the implementer from doing
so unprompted — the story deadlocks with a correct implementation.

**Recommended fix:** add an AC to <story> updating the assertion, and list
`<test file>` in that story's `Modifies`.
```

## Common Phase 2 catches

- Per-AC structured `verifiedBy` when `acceptanceCriteria: string[]` (top defect from real review)
- `criticModel: optional()` when default should be `default("fast")`
- `ctx.lastInput as TInput` when `RetryContext` has no `lastInput` field
- `transient-network` retry preset when parse failures need `makeParseRetryStrategy`
- `kind: "complete"` when single-turn LLM ops in the codebase are all `kind: "run"`
- Field used in ACs but absent from the interface definition (`revisionFindings`)
- Wrong schema file location (proposes editing `schemas.ts` when the type lives in `schemas-infra.ts`)
- An earlier feature's test asserting set-equality over a table's columns while this spec adds two of them — correct implementation, unfixable full-suite gate, terminal `agent-gave-up` (Step 7)
- A per-member type loop iterating the *actual* columns and indexing an expected map, hiding behind that set-equality assertion in the same test — relaxing only the obvious one re-fails the story on a `KeyError` (Step 7)

## Hand-off to Phase 8 — unsourced identifiers

Phase 2 falsifies the claims a spec **makes**. It cannot see the inputs a spec
**omits to source**, because an omission asserts nothing to check.

So while grounding a formula, note every identifier in it that carries no
`file:line` and is not defined by the surrounding prose — a bare `threshold`,
`config`, `limit`, `mode` sitting beside symbols that are all fully cited. Do not
resolve these here; hand them to Phase 8's contract-seam check, which asks
whether the value is reachable **at the site the spec requires it**.

This hand-off exists because the reverse has happened: a spec-review pass
correctly replaced a hallucinated enum with the real one, cited it by `file:line`,
and in the same rewritten sentence introduced a predicate call taking a bare
`threshold` argument that nothing supplied — turning a Phase 2 fix into a Phase 8
defect. Grounding the symbols you cite does not ground the values you assume, and
a rewrite is exactly when an unsourced one slips in.
