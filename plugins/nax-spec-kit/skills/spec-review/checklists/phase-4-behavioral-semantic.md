# Phase 4 — Behavioral Semantic Check

**Goal:** prose descriptions of behavior in the spec match what the referenced code actually does.

**Blocker:** spec prose describes different semantics than code implements.

This is the only LLM-judgment phase. The other phases are mechanical; this one requires understanding intent. Run it last — earlier phases reduce noise.

Check IDs (`P4.1`–`P4.12`) match the registry table in SKILL.md § Phase 4; Steps 1–4 together implement `P4.1`. Report each check with its unit-of-account count. `P4.12` is a roll-up of findings the other checks already made, re-keyed by story — it runs last and adds no new analysis.

## Step 1 (P4.1) — Build the "referenced existing behavior" inventory

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

## Step 5 (P4.2) — Cross-AC consistency (within the spec)

Beyond comparing spec to code, also compare spec ACs to spec design within the same document. Common drift:

- Design section says "drafter retries with kind-specific prompt"; AC says "retries with a generic prompt" — mismatch
- Design section says "manifest threshold is configurable"; AC asserts default value as if not configurable
- Design section says "critic does not run after blocker"; AC checks LLM is called regardless

When prose and ACs disagree within the spec, the spec itself is internally inconsistent — flag as **BLOCKER** because the implementer doesn't know which to trust.

### P4.3 — Baseline signature stated without its target (completeness)

The check above catches prose and ACs that **disagree**. This one catches prose that is
**true and still misleading**: a Design listing of the *current* shape of a symbol the spec
is about to *change*, with the target shape never stated.

Every such listing passes Phases 1, 2 and 6 — the symbol exists, the shape matches the code,
the reference is not stale. It still deadlocks the run, because `nax plan` copies Design
prose into the story's `description` and synthesises an `**Interface**` block from it. Given
only pre-change signatures, the planner has nothing else to promote, so the block it emits
carries the **old** shape while the story's own ACs require the new one. The implementer
writes correct code, the ACs go green, and semantic review quotes the interface block against
it — a claim that is quotable but reachable by no test, so rectification thrashes until the
story exits on a bail predicate.

**No code fence is required.** A plain bulleted list under a heading like "Signatures
verified at `<sha>`" is enough. Accurate, honestly labelled, and normative all the same.

Detection: build the set of symbols the spec **mutates** — anything named in a story's
`### Modifies`, in `Creates`, or in Design prose saying it gains a parameter, field, variant,
or return value. For each, scan the Design section for a signature, field list, or shape
listing of that same symbol. A listing showing only the pre-change shape, with no target
stated alongside it, is a finding. Checked **per symbol**: a spec that pairs three of five
mutated symbols leaves two unpinned.

Flag **major** (it predicts non-convergence, not incorrectness).

**Recommended fix:** restate each mutated symbol as an explicit **Baseline:** / **Target:**
pair, with a lead-in saying the baseline exists only to locate the code and is never the
interface to implement — or delete the baseline listing entirely. Stating the target is what
matters; the baseline is optional.

Note the asymmetry with the **unpinned design mandate** check below. That one fires on prose
naming an API the implementation *must use* and models the same `description`-copying
mechanism, but a baseline signature is not a mandate — it names no obligation — so it matches
neither that check nor the disagreement check above. This is the only check that reaches it.

⚠️ **Do not automate this by grepping a generated PRD for baseline fragments.** Unchanged
parameters legitimately reappear inside the target signature, so their presence proves
nothing. Read the emitted block; do not pattern-match it.

### P4.4 — Under-specified input class (completeness)

Beyond prose-vs-AC disagreement, check for **input classes no AC defines**.

**Enumerate before you judge.** Do not scan the ACs and ask what looks missing — that finds
only the dimensions the spec already put in your head. For each function the story covers,
first write down its input dimensions from the *signature and the domain*, independent of
the ACs; only then mark which are pinned. The recurring axes:

- sync factory vs **async** (`Promise`-returning) factory
- value present vs **absent/null/undefined**
- valid input vs **malformed** input
- single item vs **empty** collection vs **many**
- a text body **with** vs **without** a trailing newline (and an empty body)
- each threshold, limit or ceiling the function names — one dimension per threshold

If a class is exercised by no AC's test **and** not listed in the spec's **Out-of-scope**, flag **MAJOR**. Undefined-but-plausible input classes are where the semantic and adversarial reviewers over-interpret in *contradictory* directions at implementation time: the fix for one re-triggers the other, rectification exits `regressed-different-source`, and the story escalates tiers without converging (real case: `notif-dlq-hardening` — AC3/AC4 pinned sync-factory behavior but left async factories undefined; semantic demanded async-true→wire-DLQ while adversarial demanded async-false→throw, an unsatisfiable pair given synchronous module construction).

**Recommended fix:** add an AC pinning the class's behavior, **or** move it to Out-of-scope. Never leave it silent for the reviewers to arbitrate.

### P4.5 — Undefined dimension interaction (completeness)

The check above asks whether a dimension is **missing**. This one asks what happens when two
dimensions that are each **present** fire at the same time.

It is the more dangerous of the two, because the spec looks complete on inspection: every
axis has an AC, the coverage sweep passes, and the undefined region is the *cross-product
cell* nobody wrote down. Reviewers then arbitrate that cell in incompatible directions, and
each fix breaks the test written for the other reading.

Detection: build the set of **thresholds, limits, modes and branches** a single function
declares, where a separate AC pins each one in isolation. For every pair, ask whether any AC
or Out-of-scope entry says what happens when **both** apply to one input. Checked **per
pair**: a function with three thresholds has three pairs plus the all-three case, and pinning
two of them leaves the rest open.

Flag **major**, escalating to **blocker** when the ACs are not merely silent but
*jointly unsatisfiable* — i.e. two ACs read literally demand opposite outputs for the same
input. Silence is a deadlock risk; contradiction is a guaranteed one.

Worked example. A truncation function declared three independent ceilings — a byte cap, a
line-count cap and a per-line character cap — each pinned by its own AC, and none of the
ACs, nor any Out-of-scope entry, said which wins when a body breaks more than one. Coverage
was complete. At implementation time semantic review read the per-line AC literally ("a long
line must always be shortened") while adversarial read the line-count AC literally ("the line
ceiling binds even when the per-line path triggers"); each fix broke a test written for the
other. Three rectification iterations returned `regressed-different-source` with the finding
relocating each time, the story exhausted two model tiers, and the run was killed by hand.

**Recommended fix:** state the composition explicitly — usually an *ordered pipeline* ("cap
A applies first, then B over its output, then C last") rather than a set of alternatives —
and add one AC per interaction the order makes observable. "They are independent" is not an
answer; independence still has to say what the output looks like when two fire.

### P4.6 — Unpinned failure-handling row (completeness)

A row in the spec's `### Failure Handling` design subsection (or `## Failure Modes` prose) with **neither a covering AC in its owning story nor an entry in that story's `Out of scope`** is an authoring gap, not a planner one.

Why it matters: the planner authors the missing AC itself, so the criterion ships either way and only its *wording* is at stake — and AC wording is the reviewer's quote surface (Rule 2). See the spec-writing guide's Rule 11 for the mechanism and the observed leaks.

Detection: enumerate the rows of each story's Failure Handling subsection; for each, look for an AC asserting that behaviour, or an `Out of scope` entry naming it. Flag **major** (it predicts wording loss, not incorrectness).

**Do not flag the inverse.** An AC covering a negative path the design does *not* state is not a finding — unanticipated edge cases belong in the planner's advisory `suggestedCriteria`. Recommending they be pinned converts a safe suggestion into a permanently-red blocking criterion and spends the story's AC budget.

### P4.7 — Unpinned design mandate (completeness)

Sweep the **whole** Design section — every subsection, not just `### Failure Handling` — for prose that constrains *how* the implementation must work by naming a symbol: "Library APIs used:" lists, "X goes through `foo()` directly", "through A, **not** `B`", numbered call sequences. Each is a normative contract.

Detection: for each mandate, identify the story that owns the touchpoint (via `Modifies` / `Creates` / `Context Files`), then look for an AC in that story whose text names the mandated symbol, or an `Out of scope` entry releasing it. A mandate named in neither is a finding. Checked **per named API** — a list of four converters covered by one AC that names one of them leaves three unpinned.

Why it deadlocks rather than merely leaking wording: `nax plan` copies design prose into the story's `description`, so the mandate survives into the PRD even when no AC carries it. Semantic review can then quote it verbatim against green code, while no test can reach it — and unlike a Failure Handling row, the planner does **not** author a covering AC. The implementer picks a different-but-plausible API, every gate passes, and rectification thrashes between API shapes until the story exits on a bail predicate.

Two sub-checks:

- **Prohibitions need an observable negative.** "through the index, **not** `timeLookup()`" is pinned only by an AC that fails when `timeLookup()` is used — typically a double whose `timeLookup()` returns nothing for the inputs in question.
- **Mocked collaborator.** If the mandated API belongs to a dependency the repo stubs wholesale in that story's test environment, an AC asserting only a *downstream outcome* does not cover the mandate: the double gets reshaped to whatever the implementation calls, so the AC passes for conforming and non-conforming implementations alike. Require an AC asserting on the double's captured calls, or a double carrying the real contract. Treat outcome-only coverage as uncovered. Where the spec *itself* notes the dependency is mocked wholesale (often as the stated reason for choosing this approach over another), this sub-check is mandatory.

Note the asymmetry with Phases 5 and 8: every "must actually be invoked" guard there fires on symbols *this spec* exports (unpaired new externally-visible symbol, two-anchor seam AC, contract seams reconciled from ACs outward). A mandate to use a third-party or standard-library API matches none of them, and an AC that is silent — rather than contradictory — is invisible to the cross-AC consistency check above. This check is the only one that reaches it.

Flag **major** (it predicts non-convergence, not incorrectness).

**Recommended fix:** pin the call as an AC, soften the prose to non-normative wording ("any converter that maps an index to a pixel"), or declare it out of scope.

### P4.8 — Adversarial-scope gap (risk-sensitive stories)

A story whose subject matter is **risk-sensitive** — authentication/sessions, rate limiting/counters, replay protection (TOTP/OTP/MFA/nonce), idempotency/dedup stores (reserve-then-finalize, upsert), multi-tenancy scoping, concurrency/atomicity (check-then-act, upsert, locks), expiry/TTL/retention, crypto/secrets — but which leaves any of that domain's **canonical risk properties** (atomicity, window expiry, replay rejection, tenant scoping, expiry filtering, finalize/write-back atomicity) **neither pinned by a property-style AC nor named in an `Out of scope` entry**, is a predictable adversarial-review deadlock.

Why: the downstream adversarial reviewer runs last, on green code, and can substantiate factually-true findings about the unpinned properties against real code while quoting an adjacent AC verbatim — every such finding survives AC-grounding and blocks, round after round. It also blocks when an `Out of scope` section is *present but partial*: a reserve-then-finalize store that defers tenancy and eviction but leaves the finalize write-back's atomicity silent still deadlocks on that one property. Real case: a "persist IAM stores with Prisma" story with 7 passthrough ACs looped ~18 adversarial rounds on atomic rate-limit windows, TOTP replay-window derivation, and tenant-column nullability — none of which any AC mentioned.

Detection: match risk-domain keywords against the story's title, design touchpoints, and symbol names (not incidental word use). For each matched story, **enumerate that domain's canonical property set and check every property individually** — require, per property, either (a) a property-style AC pinning it, or (b) an explicit `Out of scope` entry naming *that* property. **A present `Out of scope` section does not satisfy properties it does not name.** Canonical property reminders: rate limiter → window expiry + atomic increment; replay store → reuse-within-window rejection; reserve-then-finalize / upsert store (idempotency, dedup, cache-fill) → atomic compare-and-set on the finalize write-back, or the concurrent-expiry clobber deferred; expiry/TTL → expired-row exclusion; multi-tenancy → tenant scoping on every read and write.

Flag **MAJOR** (it predicts non-convergence, not incorrectness). **Recommended fix:** pin each silent risk property as an executable AC, or declare it out of scope — the spec, not a downstream reviewer, must own the scope boundary.

### P4.9 — Fixture-shape derivability (satisfiability)

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

### P4.10 — Constant-value derivability (satisfiability)

The same reasoning, one level over: a **named constant or threshold** an AC's behaviour
depends on, whose value the spec never states and never explicitly delegates.

Phase 1 passes these legitimately — a constant declared under `### Creates` ("…and its
constants") is a forward-reference, and no phase asks whether a value follows. So the
implementer picks the numbers, and the reviewer judges the result against whatever numbers
*it* would have picked.

| Outcome | Action |
|:---|:---|
| Value stated, or explicitly delegated ("the implementer chooses; any value satisfying X") | ✅ pass |
| AC behaviour depends on the constant and the spec states no value and delegates nothing | ❌ **BLOCKER** — underivable |
| Several constants bound the same quantity and the spec states no relation between them | ❌ **BLOCKER** — see below |

The second row matters most when constants interact. Values that are each individually
plausible can be **jointly degenerate**: they can make one cap unreachable by any input that
satisfies the others, so a whole branch of the ACs is untestable and every boundary case
trips two caps at once. Whoever picks the values will not notice — the breach is a property
of the *combination*, and it does not exist until the last one is chosen.

Worked example. A spec named `MODEL_MAX_BYTES`, `MODEL_MAX_LINES` and `MODEL_MAX_LINE_CHARS`
and gave no values. The implementer chose 40_000, 2 and 2_000. The largest body satisfying
the two line caps is then 4,001 bytes (two 2,000-char lines and one separator) — well under
the 40,000-byte ceiling — so no compliant body can reach the byte cap, no test can isolate
it, and the test-writer had to invent a resolution the reviewers then rejected. Had the spec
stated the relation `MODEL_MAX_LINES * (MODEL_MAX_LINE_CHARS + 1) > MODEL_MAX_BYTES` — an
upper bound on the largest compliant body, since `n` lines carry `n - 1` separators — the
constraint would have been checkable before any code was written.

**Recommended fix:** state each value in the spec, or delegate it explicitly. Where several
constants bound one quantity, state the **relation** that keeps them mutually satisfiable —
that relation is reviewable even when the individual values are left to the implementer.

## Step 6 (P4.11) — Reality of "shipped" claims

When the spec says "X is already shipped" or "DONE", open the referenced file and verify it actually does what the spec claims. Just because a file exists doesn't mean its behavior matches the claim.

Specifically: enhanced-debate-phase-2 "shipped citation discipline" — but the citation parser `citations.ts` was never wired into the verifier. The spec for the next phase claimed citation gating was working when it wasn't.

Run this check by:
1. Open the file the spec credits as "shipped"
2. Search for callers of its main functions: `grep -rn "<function>" src/ | grep -v "<defining-file>"`
3. If there are zero callers outside the defining file, the function ships in name only — flag the claim as **MAJOR**

## Step 7 (P4.12) — Per-story deadlock roll-up

The preceding checks are enumerated per *item* — per dimension, per pair, per named API,
per property. Deadlock, however, is a property of a **story**: the story is the unit `nax`
runs, rectifies and escalates, and it is the unit an author has to fix or split. Three
findings scattered across three phase sections read as "the spec has some majors"; the same
three attributed to `US-003` read as "this story will not converge". This step re-keys
findings already made — it introduces no new analysis and no new findings.

**Scope.** Attribute every finding from the deadlock-class checks to the story that owns it,
via the story's `Modifies` / `Creates` / `Context Files` or the AC it was raised against. The
deadlock-class checks are:

| Source | Check | Deadlock mechanism |
|:--|:--|:--|
| Phase 4 | P4.2 | two ACs jointly unsatisfiable — the implementer cannot satisfy both |
| Phase 4 | P4.4 | silent input class — reviewers over-interpret in contradictory directions |
| Phase 4 | P4.5 | undefined cross-product cell — each fix breaks the other reading's test |
| Phase 4 | P4.7 | unpinned mandate — reachable by no test, quotable by semantic review forever |
| Phase 4 | P4.8 | unpinned risk property — adversarial substantiates it on green code, round after round |
| Phase 4 | P4.9 / P4.10 | underivable fixture or constant — the AC is permanently red |
| Phase 5 | unnamed `add validation` / `add error handling` | unpinned negative space both reviewers arbitrate |
| Phase 8 | AC noun richer than the contract emits | review holds the render to the literal noun |

A finding may be attributed to more than one story when it spans a seam; count it in each.
When a finding cannot be attributed to a single story, attribute it to the feature row.

**Verdict per story**, applied in order — the first matching rule wins:

1. **❌ DEADLOCK LIKELY** — any blocker-severity deadlock-class finding: a jointly-unsatisfiable
   AC pair (P4.2, or a P4.5 pair escalated to blocker), or an underivable fixture/constant
   (P4.9/P4.10). These do not need two reviewers to disagree; the story is unsatisfiable as
   written.
2. **⚠️ AT RISK** — two or more deadlock-class findings of *distinct* check IDs on one story.
   Two silent dimensions and an unpinned mandate is not three independent majors; it is one
   story with enough undefined surface that the reviewers have somewhere to disagree.
3. **⚠️ AT RISK** — exactly one deadlock-class finding on a story that is also risk-sensitive
   per P4.8's domain table. The adversarial reviewer runs last, on green code, and needs only
   one unpinned property.
4. **✅ CLEAR** — no deadlock-class findings, *and* every deadlock-class check reports a
   denominator for this story (see below). A story no check examined is not clear; it is
   unexamined.

**Denominators are mandatory here too.** Each cell carries `found/examined` in that check's
unit of account — `1/4` silent classes means four dimensions were enumerated and one was
silent. A cell with no denominator is `n/a` only when the check genuinely does not apply to
the story (P4.8 on a non-risk-sensitive story, P4.9 on a story with no fixtures); otherwise
it is an incomplete enumeration and the story cannot be graded ✅ CLEAR.

**Phases that did not run.** `P4.12` draws two of its inputs from Phases 5 and 8. When either was
skipped or halted, record that cell as `not run` rather than `0` — an unexamined surface is not a
clean one, and rule 4 withholds ✅ CLEAR from any story carrying a `not run` cell. Phase 4's own
checks always run (SKILL.md § Stop-the-line gate exempts the phase), so their cells are never
`not run`.

**Do not soften on aggregate.** The roll-up never lowers an individual finding's severity, and
a ✅ CLEAR story does not excuse a blocker found elsewhere in the spec. It is a reading of the
findings, not a re-adjudication of them.

**Recommended fix, by verdict.** DEADLOCK LIKELY is resolved before the story is run — pin the
contested cell, state the constant, or split the story. AT RISK is resolved the same way, or
consciously accepted with the deferral written into that story's `Out of scope` so the scope
boundary lives in the spec rather than in a reviewer's judgment at round 12.

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
- A truncation function with three ceilings — bytes, line count, per-line chars — each pinned by its own AC, and nothing saying which applies when a body breaks two: coverage complete, cross-product cell undefined, semantic and adversarial then demanded opposite outputs and the story burned two model tiers
- A spec naming `MODEL_MAX_BYTES` / `MODEL_MAX_LINES` / `MODEL_MAX_LINE_CHARS` with no values: the implementer's 40_000 / 2 / 2_000 made the byte ceiling unreachable by any body satisfying the line caps, so one cap's ACs were untestable and every boundary case tripped two at once
- A text-truncation spec that never says whether a trailing newline terminates the last line or opens an empty one — the plainest kind of undefined input class, missed because the dimensions were never enumerated before the ACs were read
- A Design "Library APIs used:" list naming four dependency methods, plus a prohibition on a fifth, that no AC of the owning story mentions — the implementer used the prohibited one, every gate went green (the harness stubbed the dependency wholesale, and the stub was reshaped to match the implementation), and semantic review blocked on the prose until the story exhausted rectification
