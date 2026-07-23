# Phase 4 — Behavioral Semantic Check

**Goal:** prose descriptions of behavior in the spec match what the referenced code actually does.

**Blocker:** spec prose describes different semantics than code implements.

This is the only LLM-judgment phase. The other phases are mechanical; this one requires understanding intent. Run it last — earlier phases reduce noise.

## Step 1 — Build the "referenced existing behavior" inventory

Scan the spec for every place that asserts behavior of code that already exists. Patterns to look for:

- "X already does Y" / "X currently does Y"
- "Reuses X" / "Delegates to X"
- "Pattern from X"
- "X handles Z"
- "X measures / validates / checks Q"

Each one is a behavioral claim about existing code. Build a list of (claim, referenced code symbol) pairs.

## Step 2 — For each claim, open the actual code

```bash
grep -rn "<symbol>" src/ | head -5
# Then Read the file at the relevant lines
```

Read enough of the implementation to understand:
- **What inputs does it take?**
- **What does it return / produce?**
- **What does it check / decide?**
- **What are its failure modes?**

## Step 3 — Compare claim vs reality

For each claim, ask:

| Question | If mismatch → |
|:---|:---|
| Does the spec describe the right inputs? | **MAJOR** |
| Does the spec describe the right outputs? | **MAJOR** |
| Does the spec describe the right decision logic? | **BLOCKER** if downstream depends on it; else **MAJOR** |
| Does the spec describe the right failure mode? | **MAJOR** |
| Does the spec's prose summary match what a reviewer would see in the code? | **MINOR** if cosmetic; **MAJOR** if it misleads implementation |

## Step 4 — Watch for these specific semantic drift patterns

### Numerator/denominator drift

"Citation rate" can mean:
- `cited claims / total claims in PRD` (what the spec usually intends)
- `verified spec claims / total spec claims in manifest` (a different number)

When a spec says "rejects when citation rate < threshold", verify which numerator/denominator the named function actually computes.

### Reuses-vs-rewires conflation

"This reuses `fooVerifier`" can mean:
- The same function is called from the new path (true reuse)
- A new function with the same name and similar logic is created (rewrite, not reuse)
- The existing function's signature requires adaptation (claimed reuse, actual refactor)

When a spec says "thin wrapper around X", open X. If X has a context shape (e.g. `PostDebateVerifier(ctx)`) that the new path can't supply, "thin wrapper" is wrong — flag as **MAJOR** with the recommendation to extract pure functions.

### Configurable vs hardcoded

"Threshold is configurable" can mean:
- Read from config at runtime (real config-driven)
- Default value declared as a constant (not actually configurable)
- Configurable but only at op-definition time (not per-call)

Verify config access path matches the lifecycle the spec implies.

### Failure-mode lift

"Returns null on failure" might be the spec's claim, but the actual code might throw. Or vice versa. Open the implementation and check.

## Step 5 — Cross-AC consistency (within the spec)

Beyond comparing spec to code, also compare spec ACs to spec design within the same document. Common drift:

- Design section says "drafter retries with kind-specific prompt"; AC says "retries with a generic prompt" — mismatch
- Design section says "manifest threshold is configurable"; AC asserts default value as if not configurable
- Design section says "critic does not run after blocker"; AC checks LLM is called regardless

When prose and ACs disagree within the spec, the spec itself is internally inconsistent — flag as **BLOCKER** because the implementer doesn't know which to trust.

### Under-specified input class (completeness)

Beyond prose-vs-AC disagreement, check for **input classes no AC defines**. For any function covered by ≥2 ACs that partition one input dimension (e.g. a return value `true`/`false`, present/absent), ask whether **another meaningful input dimension** is left behaviorally undefined:

- sync factory vs **async** (`Promise`-returning) factory
- value present vs **absent/null/undefined**
- valid input vs **malformed** input
- single item vs **empty** collection vs **many**

If a class is exercised by no AC's test **and** not listed in the spec's **Out-of-scope**, flag **MAJOR**. Undefined-but-plausible input classes are where the semantic and adversarial reviewers over-interpret in *contradictory* directions at implementation time: the fix for one re-triggers the other, rectification exits `regressed-different-source`, and the story escalates tiers without converging (real case: `notif-dlq-hardening` — AC3/AC4 pinned sync-factory behavior but left async factories undefined; semantic demanded async-true→wire-DLQ while adversarial demanded async-false→throw, an unsatisfiable pair given synchronous module construction).

**Recommended fix:** add an AC pinning the class's behavior, **or** move it to Out-of-scope. Never leave it silent for the reviewers to arbitrate.

### Adversarial-scope gap (risk-sensitive stories)

A story whose subject matter is **risk-sensitive** — authentication/sessions, rate limiting/counters, replay protection (TOTP/OTP/MFA/nonce), idempotency/dedup stores (reserve-then-finalize, upsert), multi-tenancy scoping, concurrency/atomicity (check-then-act, upsert, locks), expiry/TTL/retention, crypto/secrets — but which leaves any of that domain's **canonical risk properties** (atomicity, window expiry, replay rejection, tenant scoping, expiry filtering, finalize/write-back atomicity) **neither pinned by a property-style AC nor named in an `Out of scope` entry**, is a predictable adversarial-review deadlock.

Why: the downstream adversarial reviewer runs last, on green code, and can substantiate factually-true findings about the unpinned properties against real code while quoting an adjacent AC verbatim — every such finding survives AC-grounding and blocks, round after round. It also blocks when an `Out of scope` section is *present but partial*: a reserve-then-finalize store that defers tenancy and eviction but leaves the finalize write-back's atomicity silent still deadlocks on that one property. Real case: a "persist IAM stores with Prisma" story with 7 passthrough ACs looped ~18 adversarial rounds on atomic rate-limit windows, TOTP replay-window derivation, and tenant-column nullability — none of which any AC mentioned.

Detection: match risk-domain keywords against the story's title, design touchpoints, and symbol names (not incidental word use). For each matched story, **enumerate that domain's canonical property set and check every property individually** — require, per property, either (a) a property-style AC pinning it, or (b) an explicit `Out of scope` entry naming *that* property. **A present `Out of scope` section does not satisfy properties it does not name.** Canonical property reminders: rate limiter → window expiry + atomic increment; replay store → reuse-within-window rejection; reserve-then-finalize / upsert store (idempotency, dedup, cache-fill) → atomic compare-and-set on the finalize write-back, or the concurrent-expiry clobber deferred; expiry/TTL → expired-row exclusion; multi-tenancy → tenant scoping on every read and write.

Flag **MAJOR** (it predicts non-convergence, not incorrectness). **Recommended fix:** pin each silent risk property as an executable AC, or declare it out of scope — the spec, not a downstream reviewer, must own the scope boundary.

## Step 6 — Reality of "shipped" claims

When the spec says "X is already shipped" or "DONE", open the referenced file and verify it actually does what the spec claims. Just because a file exists doesn't mean its behavior matches the claim.

Specifically: enhanced-debate-phase-2 "shipped citation discipline" — but the citation parser `citations.ts` was never wired into the verifier. The spec for the next phase claimed citation gating was working when it wasn't.

Run this check by:
1. Open the file the spec credits as "shipped"
2. Search for callers of its main functions: `grep -rn "<function>" src/ | grep -v "<defining-file>"`
3. If there are zero callers outside the defining file, the function ships in name only — flag the claim as **MAJOR**

## Finding template

```markdown
### Blocker — Spec prose describes different behavior than code implements

**Spec reference:** <section> line <N>
> <spec prose quote>

**Code reference:** [`<file>:<lines>`](<file>#L<lines>)
```typescript
<code excerpt>
```

**Semantic mismatch:** <one paragraph explaining the divergence — which input/output/decision differs>

**Why it matters:** <what fails when implementer follows the spec — wrong test fixture, missing wiring, etc.>

**Recommended fix:** <revise prose OR change the proposed implementation to match prose>
```

## Common Phase 4 catches

- "`claims-cited` rejects uncited PRD claims" but the code measures manifest verification rate
- "`plan-checklist.ts` is reusable as Phase 3" but its shape is `PostDebateVerifier(ctx)`, incompatible with op-shaped usage
- "`citations.ts` provides citation discipline" but no caller wires it — ships in name only
- "Single-turn LLM op via `complete`" but every existing single-turn LLM op uses `run`
- "Grounder validates schema" but the retry inspects only JSON validity, not schema
- "Configurable threshold" but threshold actually lives as a module constant
- ACs pin sync-factory behavior (true→wire, false→throw) but never define async factories — undefined input class the reviewers later demand contradictory behavior for
- IAM-store story with 7 happy-path passthrough ACs and no atomicity/replay/tenancy AC or out-of-scope declaration — adversarial reviewer blocked ~18 rounds on the silent properties
- Reserve-then-finalize store whose `Out of scope` defers tenancy + eviction but never names the finalize write-back's atomicity — the present-but-partial deferral that still deadlocks, because coverage must be per-property
