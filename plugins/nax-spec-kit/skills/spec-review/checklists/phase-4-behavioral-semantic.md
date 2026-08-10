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

### Unpinned failure-handling row (completeness)

A row in the spec's `### Failure Handling` design subsection (or `## Failure Modes` prose) with **neither a covering AC in its owning story nor an entry in that story's `Out of scope`** is an authoring gap, not a planner one.

Why it matters: the planner authors the missing AC itself, so the criterion ships either way and only its *wording* is at stake — and AC wording is the reviewer's quote surface (Rule 2). See the spec-writing guide's Rule 11 for the mechanism and the observed leaks.

Detection: enumerate the rows of each story's Failure Handling subsection; for each, look for an AC asserting that behaviour, or an `Out of scope` entry naming it. Flag **major** (it predicts wording loss, not incorrectness).

**Do not flag the inverse.** An AC covering a negative path the design does *not* state is not a finding — unanticipated edge cases belong in the planner's advisory `suggestedCriteria`. Recommending they be pinned converts a safe suggestion into a permanently-red blocking criterion and spends the story's AC budget.

### Unpinned design mandate (completeness)

Sweep the **whole** Design section — every subsection, not just `### Failure Handling` — for prose that constrains *how* the implementation must work by naming a symbol: "Library APIs used:" lists, "X goes through `foo()` directly", "through A, **not** `B`", numbered call sequences. Each is a normative contract.

Detection: for each mandate, identify the story that owns the touchpoint (via `Modifies` / `Creates` / `Context Files`), then look for an AC in that story whose text names the mandated symbol, or an `Out of scope` entry releasing it. A mandate named in neither is a finding. Checked **per named API** — a list of four converters covered by one AC that names one of them leaves three unpinned.

Why it deadlocks rather than merely leaking wording: `nax plan` copies design prose into the story's `description`, so the mandate survives into the PRD even when no AC carries it. Semantic review can then quote it verbatim against green code, while no test can reach it — and unlike a Failure Handling row, the planner does **not** author a covering AC. The implementer picks a different-but-plausible API, every gate passes, and rectification thrashes between API shapes until the story exits on a bail predicate.

Two sub-checks:

- **Prohibitions need an observable negative.** "through the index, **not** `timeLookup()`" is pinned only by an AC that fails when `timeLookup()` is used — typically a double whose `timeLookup()` returns nothing for the inputs in question.
- **Mocked collaborator.** If the mandated API belongs to a dependency the repo stubs wholesale in that story's test environment, an AC asserting only a *downstream outcome* does not cover the mandate: the double gets reshaped to whatever the implementation calls, so the AC passes for conforming and non-conforming implementations alike. Require an AC asserting on the double's captured calls, or a double carrying the real contract. Treat outcome-only coverage as uncovered. Where the spec *itself* notes the dependency is mocked wholesale (often as the stated reason for choosing this approach over another), this sub-check is mandatory.

Note the asymmetry with Phases 5 and 8: every "must actually be invoked" guard there fires on symbols *this spec* exports (unpaired new externally-visible symbol, two-anchor seam AC, contract seams reconciled from ACs outward). A mandate to use a third-party or standard-library API matches none of them, and an AC that is silent — rather than contradictory — is invisible to the cross-AC consistency check above. This check is the only one that reaches it.

Flag **major** (it predicts non-convergence, not incorrectness).

**Recommended fix:** pin the call as an AC, soften the prose to non-normative wording ("any converter that maps an index to a pixel"), or declare it out of scope.

### Adversarial-scope gap (risk-sensitive stories)

A story whose subject matter is **risk-sensitive** — authentication/sessions, rate limiting/counters, replay protection (TOTP/OTP/MFA/nonce), idempotency/dedup stores (reserve-then-finalize, upsert), multi-tenancy scoping, concurrency/atomicity (check-then-act, upsert, locks), expiry/TTL/retention, crypto/secrets — but which leaves any of that domain's **canonical risk properties** (atomicity, window expiry, replay rejection, tenant scoping, expiry filtering, finalize/write-back atomicity) **neither pinned by a property-style AC nor named in an `Out of scope` entry**, is a predictable adversarial-review deadlock.

Why: the downstream adversarial reviewer runs last, on green code, and can substantiate factually-true findings about the unpinned properties against real code while quoting an adjacent AC verbatim — every such finding survives AC-grounding and blocks, round after round. It also blocks when an `Out of scope` section is *present but partial*: a reserve-then-finalize store that defers tenancy and eviction but leaves the finalize write-back's atomicity silent still deadlocks on that one property. Real case: a "persist IAM stores with Prisma" story with 7 passthrough ACs looped ~18 adversarial rounds on atomic rate-limit windows, TOTP replay-window derivation, and tenant-column nullability — none of which any AC mentioned.

Detection: match risk-domain keywords against the story's title, design touchpoints, and symbol names (not incidental word use). For each matched story, **enumerate that domain's canonical property set and check every property individually** — require, per property, either (a) a property-style AC pinning it, or (b) an explicit `Out of scope` entry naming *that* property. **A present `Out of scope` section does not satisfy properties it does not name.** Canonical property reminders: rate limiter → window expiry + atomic increment; replay store → reuse-within-window rejection; reserve-then-finalize / upsert store (idempotency, dedup, cache-fill) → atomic compare-and-set on the finalize write-back, or the concurrent-expiry clobber deferred; expiry/TTL → expired-row exclusion; multi-tenancy → tenant scoping on every read and write.

Flag **MAJOR** (it predicts non-convergence, not incorrectness). **Recommended fix:** pin each silent risk property as an executable AC, or declare it out of scope — the spec, not a downstream reviewer, must own the scope boundary.

### Fixture-shape derivability (satisfiability)

When an AC asserts a **property of a fixture** — "only `t*` is True", "exactly 3
rows", "sorted ascending by timestamp", "the second entry is empty" — that property
must follow from however the spec says the fixture is built. Derive it yourself
from the spec's stated generation procedure and compare.

This is a satisfiability check, not a correctness one, and that is why it belongs
in the judgment phase rather than Phase 1: the literal exists, the code is fine,
and the AC is still impossible.

| Outcome | Action |
|:---|:---|
| Property follows from the procedure | ✅ pass |
| Property contradicts the procedure | ❌ **BLOCKER** — no implementation can satisfy it |
| Spec asserts the property but never says how the fixture is built | ❌ **BLOCKER** — underivable; the implementer invents a fixture, the reviewer checks against a different imagined one |

Worked example. A spec's generation procedure sets a flag for every row matching a
prefix, and the AC asserts "only `t*` is True". If the described procedure produces
17 matching rows, the AC is false against the spec's own fixture. The implementer
cannot satisfy it, the reviewer cannot pass it, and the story burned 4+ blocking
rounds before a human read both halves together.

Ask the question in this direction — *"what does the described procedure produce?"*
— and only then compare to the claim. Reading the claim first primes you to accept
it.

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

- An AC asserting a fixture property the spec's own generation procedure contradicts — unsatisfiable as written (Step 5)
- "`claims-cited` rejects uncited PRD claims" but the code measures manifest verification rate
- "`plan-checklist.ts` is reusable as Phase 3" but its shape is `PostDebateVerifier(ctx)`, incompatible with op-shaped usage
- "`citations.ts` provides citation discipline" but no caller wires it — ships in name only
- "Single-turn LLM op via `complete`" but every existing single-turn LLM op uses `run`
- "Grounder validates schema" but the retry inspects only JSON validity, not schema
- "Configurable threshold" but threshold actually lives as a module constant
- ACs pin sync-factory behavior (true→wire, false→throw) but never define async factories — undefined input class the reviewers later demand contradictory behavior for
- IAM-store story with 7 happy-path passthrough ACs and no atomicity/replay/tenancy AC or out-of-scope declaration — adversarial reviewer blocked ~18 rounds on the silent properties
- Reserve-then-finalize store whose `Out of scope` defers tenancy + eviction but never names the finalize write-back's atomicity — the present-but-partial deferral that still deadlocks, because coverage must be per-property
- A `### Failure Handling` row ("warn and skip an unmarked position") with no covering AC and no out-of-scope entry — the planner writes the AC instead, in its own words, with no locus token
- A Design "Library APIs used:" list naming four dependency methods, plus a prohibition on a fifth, that no AC of the owning story mentions — the implementer used the prohibited one, every gate went green (the harness stubbed the dependency wholesale, and the stub was reshaped to match the implementation), and semantic review blocked on the prose until the story exhausted rectification
