# Worked Example — SPEC-plan-asymmetric-pipeline.md

A walkthrough of what `spec-review` catches when run against the asymmetric-pipeline spec **before** the manual back-and-forth that polished it. Every finding below was discovered during the real review; the skill exists to surface them mechanically on the first pass.

## Setup

```
Spec: /home/williamkhoo/Desktop/projects/nathapp/ai-coder/nax/docs/specs/SPEC-plan-asymmetric-pipeline.md
Project: /home/williamkhoo/Desktop/projects/nathapp/ai-coder/nax
Rules: .claude/rules/{forbidden-patterns,retry-strategy,adapter-wiring,...}.md
AC cap: 15 (derived from project conventions)
```

## Findings (first revision)

### Phase 1 — Symbol Existence (1 blocker, 1 major)

#### Blocker — `ctx.lastInput` not found

**Spec reference:** Design §"Tiered parse retry helper" — the `makeTieredParseRetryStrategy` definition references `ctx.lastInput as TInput`

**Codebase reality:** `RetryContext` at [src/agents/retry/types.ts:9-16](src/agents/retry/types.ts#L9-L16) has only `site`, `agentName`, `stage`, `storyId`, `lastOutput`, `lastTurnResult`. No `lastInput`.

**Recommended fix:** Drop `input` parameter from inspector signature; use default constants for any input-dependent classification. The op's `parse()` still enforces the configured value authoritatively.

#### Major — `FAIL_OPEN_DRAFT` referenced before defined

**Spec reference:** US-003 AC mentions `FAIL_OPEN_DRAFT` as the exhaustion fallback

**Codebase reality:** Not found in codebase; not listed in spec's "Remaining work" table

**Recommended fix:** Add `FAIL_OPEN_DRAFT` constant to the Design section's `plan-draft.ts` block, mirroring `FAIL_OPEN` from [src/operations/semantic-review.ts:43](src/operations/semantic-review.ts#L43).

---

### Phase 2 — Shape Audit (2 blockers, 2 majors)

#### Blocker — Per-AC `verifiedBy` contradicts `acceptanceCriteria: string[]`

**Spec reference:** Design §3 Phase 2 example shows
```jsonc
"acceptanceCriteria": [{
  "text": "...",
  "verifiedBy": { "kind": "test", ... }
}]
```

**Codebase reality:** [src/prd/types.ts:107](src/prd/types.ts#L107) defines `acceptanceCriteria: string[]`. `verifiedBy` is a **story-level** field at [types.ts:131-136](src/prd/types.ts#L131-L136).

**Mismatch:** Spec proposes per-AC structured objects; schema requires flat strings. Implementation would fail schema validation at runtime.

**Recommended fix:** Revise example to use story-level `verifiedBy`. If per-AC anchoring is truly needed, raise a separate breaking-schema RFC.

#### Blocker — `criticModel: ConfiguredModelSchema.optional()` but default should be `"fast"`

**Spec reference:** Design §"Config schema"

**Codebase reality:** Pattern from existing fields: `GrounderConfigSchema.model: ConfiguredModelSchema.default("fast")` ([src/config/schemas-debate.ts:12](src/config/schemas-debate.ts#L12)) — grounder defaults to `fast` for the same reason (structured extraction is cheap).

**Recommended fix:** Change to `.default("fast")` matching grounder convention.

#### Major — `planConfigSelector` slice does not include `routing`

**Spec reference:** Drafter model resolver `ctx.config.plan?.model ?? ctx.config.routing?.balanced?.model ?? "balanced"`

**Codebase reality:** [src/config/selectors.ts:24](src/config/selectors.ts#L24) — `planConfigSelector = pickSelector("plan", "plan", "debate")`. No `routing` slice.

**Mismatch:** `ctx.config.routing` is `undefined` at runtime; the fallback chain is broken.

**Recommended fix:** Drop the `routing` reference. Fall back to `"fast"` (matches grounder).

#### Major — `revisionFindings` referenced in ACs but absent from `PlanDraftInput`

**Spec reference:** US-003 AC mentions `revisionFindings` parameter; US-005 AC asserts it's passed through

**Codebase reality:** Spec's `PlanDraftInput` interface in Design does not include this field

**Recommended fix:** Add `readonly revisionFindings?: readonly VerifierFinding[]` to the interface, with a doc comment explaining its role in the revision loop.

---

### Phase 3 — Convention Audit (3 blockers, 1 major)

#### Blocker — Bare `JSON.parse(output)` violates `forbidden-patterns.md`

**Spec reference:** Critic op `retry.parse: (output) => JSON.parse(output)`

**Rule violated:** [.claude/rules/forbidden-patterns.md](.claude/rules/forbidden-patterns.md) — "Hand-rolled LLM JSON extraction... | `parseLLMJson<T>(output)` from `src/utils/llm-json`"

**Recommended fix:** Replace with `parseLLMJson(output)`. This is the SSOT for LLM output parsing; bare `JSON.parse` silently fails on fence-wrapped, preamble-padded, or trailing-comma responses.

#### Blocker — `transient-network` preset does not retry on `ParseValidationError`

**Spec reference:** Critic op `retry: { preset: "transient-network", maxAttempts: 2 }`

**Rule violated:** [.claude/rules/retry-strategy.md](.claude/rules/retry-strategy.md) — "`preset: 'transient-network'` | Retry on any thrown `Error` or `AdapterFailure` where `af.retriable === true`"

**Mismatch:** `ParseValidationError` is not a retriable adapter failure; the preset would never fire. Retry budget effectively zero.

**Recommended fix:** Use `makeParseRetryStrategy` or a custom strategy with `exhaustedFallback`.

#### Blocker — Strict-throwing `parse()` on run-kind op without `exhaustedFallback`

**Spec reference:** `planDraftOp.parse()` throws `ParseValidationError`; `retry` declared without explicit fallback in first revision

**Rule violated:** [.claude/rules/retry-strategy.md](.claude/rules/retry-strategy.md) — "Run-kind op with strict (throwing) `parse()` and `op.retry` but no `exhaustedFallback` AND no `op.recover` that returns a non-null value → Provide `exhaustedFallback` on the strategy, OR a graceful-degradation `parse()`, OR `op.recover`"

**Recommended fix:** Add `exhaustedFallback` returning `{ prd, citationRate, advisory: true }` when partial PRD is available; `FAIL_OPEN_DRAFT` otherwise.

#### Major — `kind: "complete"` for single-turn LLM op diverges from codebase convention

**Spec reference:** `planCriticLlmOp.kind === "complete"`

**Codebase reality:** Every existing single-turn LLM op is `kind: "run"`:
- `groundOp` at [src/operations/ground.ts:155](src/operations/ground.ts#L155)
- `planInteractiveOp` at [src/operations/plan.ts:23](src/operations/plan.ts#L23)
- `semanticReviewOp` at [src/operations/semantic-review.ts](src/operations/semantic-review.ts)
- `adversarialReviewOp` at [src/operations/adversarial-review.ts](src/operations/adversarial-review.ts)

**Why it matters:** [.claude/rules/retry-strategy.md](.claude/rules/retry-strategy.md) — "For complete-kind ops, hitting the ceiling always throws `CALL_OP_MAX_RETRIES`. For run-kind ops with `op.retry`, the ceiling triggers `CALL_OP_MAX_RETRIES` only if the final `op.parse` also fails — graceful-degradation parsers (returning `FAIL_OPEN`-style values) absorb the exhaustion silently."

The critic must fail-open on exhaustion. Run-kind makes that natural.

**Recommended fix:** Change to `kind: "run"`; `build()` returns plain string (not `{ prompt }`).

---

### Phase 4 — Behavioral Semantic Check (2 majors)

#### Major — `claims-cited` description doesn't match implementation

**Spec reference:** Design §3 Phase 2 — "uncited concrete claims (file paths, function names, existing behaviors) are rejected mechanically"

**Codebase reality:** [src/debate/verifiers/plan-checklist.ts:104-122](src/debate/verifiers/plan-checklist.ts#L104-L122) — `checkClaimsCited` measures `verified.length / specClaims.length` from the manifest, NOT PRD-claim citation rate.

**Semantic mismatch:** Spec describes the PRD-claim citation check (using `citations.ts`); code implements the manifest spec-claim verification check (different metric).

**Why it matters:** ACs derived from the spec's description would test the wrong behavior; the actual hallucination gate the spec needs (`citations.ts` + `citationRate`) is unwired.

**Recommended fix:** Distinguish the two metrics in the spec. Add a new `validateDraftCitations` helper that wires `citations.ts` for the spec's intended check. Keep the existing `checkClaimsCited` for the manifest metric.

#### Major — `plan-checklist.ts` claimed reusable "as-is" but shape is incompatible

**Spec reference:** Design §"Implementation Surface" — `plan-checklist.ts` listed as `DONE` and "Phase 3 closed checklist"

**Codebase reality:** [src/debate/verifiers/plan-checklist.ts:185-218](src/debate/verifiers/plan-checklist.ts#L185-L218) — signature is `PostDebateVerifier(ctx)`, reading `ctx.selectorResult.output` and `ctx.stageConfig.postDebateVerifier?.onBlocker`. Pipeline mode has no selector and no debate stage config.

**Semantic mismatch:** "Reusable as-is" understates the integration work. Pipeline mode needs the pure check functions extracted; the `PostDebateVerifier` shape is debate-specific.

**Recommended fix:** Add a refactor step to US-002: extract `checkFilesExist`, `checkAcAnchored`, etc. into `src/debate/verifiers/checks.ts` as pure functions. `planChecklistVerifier` becomes a thin adapter that calls them; pipeline mode calls them directly.

---

### Phase 5 — Sizing & Hygiene (4 majors)

#### Major — US-003 has 27 ACs (cap: 15)

**Suggested consolidations:**
- Merge the three "inspect kind=X returns Y" ACs (one per kind) into one parameterized AC with the three kind→fixture pairs listed
- Merge the three `buildXxxRetryPrompt` ACs into one with the three kind→builder method mappings
- Merge the three "parse throws for fixture X" ACs into one

After consolidation, expected count ≈ 12.

#### Major — US-001 has 17 ACs (cap: 15)

**Suggested consolidations:**
- Merge "accepts mode=single", "accepts mode=debate", "accepts mode=pipeline" into one AC with the set
- Merge "rejects mode=unknown" and "rejects citationThreshold=1.5" into one AC

After consolidation, expected count ≈ 11.

#### Major — US-004 has 18 ACs (cap: 15)

**Suggested consolidations:**
- Merge `inspectCriticOutput` per-kind ACs
- Merge `buildCriticRetryPrompt` per-kind ACs
- Merge the `parse throws` per-fixture ACs

After consolidation, expected count ≈ 10.

#### Major — Duplicate AC in US-004

Two ACs assert different things about `build`'s return:
- "returns a `string`"
- "returns `{ prompt }` where `prompt` is non-empty"

The second is stale (left over from when the op was `kind: "complete"`). Drop it; keep the first.

---

### Phase 6 — Stale References (2 majors)

#### Major — Schema "MODIFY (additive)" for fields already shipped

**Spec reference:** §"Remaining work" lists `src/prd/schema.ts` as "MODIFY (additive)" for `verifiedBy`, `intent`, `contextFiles[].factId`

**Codebase reality:** All three fields already exist:
- `verifiedBy` at [src/prd/schema.ts:240-252](src/prd/schema.ts#L240-L252)
- `intent` at [src/prd/schema.ts:255](src/prd/schema.ts#L255)
- `contextFiles[].factId` via `ContextFileEntry` at [src/prd/types.ts:11-15](src/prd/types.ts#L11-L15), parsed at [schema.ts:226-229](src/prd/schema.ts#L226-L229)

**Impact:** The "modify" line item is a no-op. Implementer wastes time looking for changes to make.

**Recommended fix:** Remove from "Remaining work"; move the fields to the "Already shipped" table.

#### Major — `citations.ts` claimed shipped but has zero callers

**Spec reference:** §"Already shipped" lists `src/debate/citations.ts` as `DONE`

**Codebase reality:**
```bash
$ grep -rn "extractClaims\|citationRate\|citationDistribution" src/ | grep -v citations.ts
# (empty)
```

The functions exist but no caller wires them. "Shipped in name only" — the citation discipline the spec credits to Phase 2 doesn't actually run anywhere.

**Recommended fix:** Mark as `DONE (UNWIRED)` in the table; explicitly call out that the pipeline drafter is the first consumer. Adjust dependent ACs accordingly.

---

## Report verdict

```
Phases run: 6 / 6
Verdict: ❌ Major rework needed

Phase 1: 1 blocker, 1 major
Phase 2: 2 blockers, 2 majors
Phase 3: 3 blockers, 1 major
Phase 4: 2 majors
Phase 5: 4 majors (mechanical — count consolidation)
Phase 6: 2 majors

Total: 6 blockers, 12 majors, 0 minors
```

## What the manual review actually took

Without the skill, this review took **~10 conversational turns** with the user, iterating one or two findings at a time. The skill compresses that into a single report run in roughly one tool-call burst per phase.

The Phase 1 `ctx.lastInput` finding alone — the runtime-breaking gap — was caught in turn 9 of the manual review (very late). With the skill, it would surface in Phase 1 before any other phase runs.
