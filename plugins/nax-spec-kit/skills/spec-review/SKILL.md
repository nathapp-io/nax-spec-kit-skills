---
name: spec-review
description: Use this skill to systematically review an implementation spec against the actual codebase before handing it off to implementers. Catches API hallucination (named symbols that don't exist), PRD↔code contradictions (proposed shapes incompatible with real schemas/types), convention violations (forbidden patterns, wrong file locations, unknown session roles), behavioral semantic drift (spec prose vs actual code behavior), sizing breaches (AC caps), stale references from earlier revisions, and (when --prd is passed) spec-to-PRD fidelity loss after `nax plan`. Invoke when the user asks to "review this spec", "check this spec against the codebase", "audit this spec for hallucination", "audit the PRD against the spec", or `/spec-review <path>`. Project-agnostic — loads `.nax/rules/` (nax-native, higher priority) and `.claude/rules/` dynamically.
---

# Spec Review Skill

A nine-phase audit that grounds an implementation spec in the actual codebase before any code is written, and (when a PRD is present) verifies the spec→PRD transformation preserved load-bearing assertions. Each phase has a stop-the-line gate — if it produces blockers, the next phase doesn't run until they're resolved.

## When to Activate

- User asks "review this spec", "check this spec", "audit this spec" with a file path
- User invokes `/spec-review <path>` explicitly
- After drafting a spec via `feature-dev:code-architect`, before opening US-001
- In a PR check for any PR that adds or substantially modifies a file under `docs/specs/`
- Before declaring a spec "ready for implementation"

## When NOT to Activate

- Spec is in active drafting (not yet stable) — review wastes effort
- Spec is for greenfield code with no existing codebase to ground against — Phase 1/2/3 produce noise (but Phase 8's data-availability seam still applies: it reconciles the spec's *own* new producer/consumer contracts against each other, not against code)
- The request is "is this design good?" — that's a design review, use `architect` or `code-reviewer` instead. This skill checks internal consistency and grounding, not architecture quality.

## Inputs

- **Required:** absolute path to the spec markdown file
- **Optional:** path to project root if it cannot be inferred from the spec location
- **Optional:** path to a generated `prd.json` (e.g. `.nax/features/<feature>/prd.json`). When passed, phases 7-9 (sizing+, seam+verification, PRD fidelity) run. Invocation: `/spec-review --spec <spec.md> --prd <prd.json>`.

## Workflow

The audit runs up to nine phases in order. Phases 1-6 always run; phases 7-9 run when applicable (large story → 7; new exported symbols → 8; `--prd` passed → 9). Each phase has a clear input/output contract and a defined blocker definition. **Do not skip phases** — earlier phases produce the symbol set / shape data that later phases consume.

### Phase 1 — Symbol existence audit

See [checklists/phase-1-symbol-existence.md](checklists/phase-1-symbol-existence.md).

Extract every named symbol (file path, function, type, constant, config key) the spec mentions. For each, verify it either already exists OR is explicitly listed in the spec's "Remaining work" / "New code" section.

**Blocker:** any symbol that exists in neither the codebase nor the spec's new-work table.
**Output:** an allowlist of forward-references (symbols the spec is creating) for later phases.

### Phase 2 — Shape audit

See [checklists/phase-2-shape-audit.md](checklists/phase-2-shape-audit.md).

For every claim of the form "X has field Y" or "X(args) returns Z", open the actual source and compare. Includes interface field membership, function signatures, default values, enum members.

**Blocker:** any structural claim contradicted by code (e.g. spec proposes per-AC `verifiedBy` but `acceptanceCriteria: string[]`).
**Output:** a list of corrections the spec needs.

### Phase 3 — Convention audit

See [checklists/phase-3-convention-audit.md](checklists/phase-3-convention-audit.md).

Load every rule file under the project's rule store(s) — `.nax/rules/` (nax-native canonical store, **higher priority**) and `.claude/rules/` — and apply forbidden-pattern / required-pattern checks against the spec's code blocks. On conflict, a `.nax/rules/` directive overrides a `.claude/rules/` one. Project-agnostic: rules come from the project, not hardcoded.

**Blocker:** any forbidden pattern in the spec, any required pattern missing where required.

### Phase 4 — Behavioral semantic check

See [checklists/phase-4-behavioral-semantic.md](checklists/phase-4-behavioral-semantic.md).

The only LLM-judgment phase. For each named check/function the spec describes behaviorally, open the actual implementation and confirm prose matches code semantics. Also runs two completeness checks: **under-specified input classes** (an input dimension no AC pins and no Out-of-scope entry defers) and the **adversarial-scope gap** (a risk-sensitive story — auth, rate limiting, replay/MFA, idempotency/dedup stores, tenancy, concurrency, expiry, crypto — that leaves any canonical risk property of its domain neither pinned by a property-style AC nor named in an Out-of-scope entry; checked **per-property**, so a present-but-partial Out-of-scope section does not cover the properties it stays silent about; a predictable adversarial-review deadlock, flagged major).

**Blocker:** spec prose describes different semantics than the code implements (e.g. "rejects uncited PRD claims" when the code measures manifest verification rate).
**Major:** under-specified input class; adversarial-scope gap on a risk-sensitive story.

### Phase 5 — Sizing & hygiene

See [checklists/phase-5-sizing-hygiene.md](checklists/phase-5-sizing-hygiene.md).

Mechanical: AC counts per story, story counts, duplicate detection, story name ↔ body alignment, dependency DAG validity.

**Blocker:** AC count exceeds project cap (load from `config.precheck.storySizeGate.maxAcCount` or default 15).

### Phase 6 — Stale-reference sweep

See [checklists/phase-6-stale-references.md](checklists/phase-6-stale-references.md).

For every "already shipped" / "DONE" / "MODIFY (additive)" claim, verify against current state. Catches revision artifacts.

**Blocker:** claims that contradict observable git state.

### Phase 7 — Verification-anchor lint

Parse every AC and classify its verification mechanism. Only **runtime** tags
are valid: `[unit]`, `[integration]`, `[cli]`. The `[grep]`, `[file]`, and
`[verbatim]` tags are **deprecated and banned** — they describe file-content
greps, which are not agent-implementable test cases (see below).

Checks:

1. **Every AC has a runtime mechanism.** ACs with no tag, an embedded command,
   or a `[grep]`/`[file]`/`[verbatim]` tag are flagged. Each AC must be a real
   runtime test (`[unit]`/`[integration]`/`[cli]`) an implementer can write
   fail-first then make pass.
2. **No file-content / grep / shell AC.** Any AC phrased as "file X contains /
   matches / does not contain Y," or containing shell commands or pipelines
   (`grep`, `wc`, `find`, `awk`, `sed`, shell pipe `|`, `$(...)`), is a
   **blocker**. Rewrite into the runtime behaviour it proves, per the
   spec-writing skill's §Nax-friendly AC format conversion table (e.g. "file
   contains `class Foo`" → `[unit]` `Foo` is importable from `<module>` and
   usable as a type). Rationale: `nax plan` feeds each AC into an agent
   implementation session that writes a test then code to pass it — a
   file-content assertion either can't be tested (negative greps) or passes on a
   pasted string in a comment, proving nothing.
3. **Symbol existence is proven by use.** A "symbol exists" claim must be a
   `[unit]` test that imports/references and exercises the symbol, not an
   assertion about its source text.
4. **Two-anchor rule.** A new exported symbol must have a **seam AC**: a
   `[unit]`/`[integration]` test that stubs the symbol, triggers the production
   caller's path, and asserts the symbol was invoked with expected arguments.
   Symbol-exists tests alone satisfy "make tests green" without integrating.
5. **Removal / absence is not an AC.** Removal claims belong in the host
   project's build/static gate (compiler/linter/`bun run typecheck`), recorded as a
   verification note — not in `acceptanceCriteria`. An AC asserting "no file
   contains X" is a blocker.
6. **Meta-AC backing.** ACs asserting architectural properties (e.g. "only N
   edit points") must be expressible as a runtime test or routed to the
   build/static gate. Aspirational meta-ACs with neither are flagged.

**Blocker:** missing/invalid mechanism; `[grep]`/`[file]`/`[verbatim]` tag;
file-content or shell AC; unpaired new exported symbol with no behavioral seam
AC; removal/absence encoded as an AC; unbacked meta-AC.

### Phase 8 — Seam & deletion audit

Walks the spec's Design and Stories to detect producer/consumer seams and
removal patterns.

Checks:

1. **Seam coverage.** For every new exported symbol the spec introduces, find a
   behavioral seam AC (or `## Seams` entry): a `[unit]`/`[integration]` test that
   stubs the symbol, triggers the production caller, and asserts it was invoked.
   Symbol exists ≠ symbol used — and "source text mentions the call" ≠ "the call
   runs."
   - **Seam altitude.** The seam AC's trigger must name the **outermost
     production entry point** (route / command / event `publish` / tick), not an
     intermediate helper the feature introduces. If wiring logic (a guard,
     mapping, or once-per-transition/dedup check) sits between the entry point
     and the stubbed symbol, an AC that triggers *below* it is a blocker — it
     ships green while leaving the production path unproven, and the story
     deadlocks in adversarial review (the notify-outbound US-005 failure mode).
   - **Guarded-seam re-trigger.** If the wiring is guarded (once-per-transition,
     dedup, idempotency), require a second seam AC that re-triggers the entry
     point and asserts the symbol is NOT invoked again. Its absence is a finding.
2. **"Replaces X" wiring.** Any "X replaces Y" / "supersedes Y" claim must have
   an AC asserting Y's former callers now invoke X (via a stub/spy on X) — not
   just that X exists.
3. **Removal-keyword sweep.** Scan spec body and story summaries for
   `delete|remove|consolidate|retire|rename`. Each match must trace to a
   **build/static-gate verification note** (compiler/linter/`bun run typecheck` confirms
   the symbol is gone) — not to an acceptance criterion. A removal encoded as a
   file-content "does not contain" AC is a blocker.
4. **Deletion isolation.** Stories that contain both additive ACs and destructive
   ACs are flagged as splittable per the spec-writing terminal-cleanup-story
   rule. Pure terminal-cleanup stories (deletion-only) pass.
5. **Sizing+.** Re-run the spec-writing hard splitting rules — Context Files >5
   or AC count >15 in a single story is a blocker, regardless of `maxAcCount`.
   The "single story with sub-deliverables" framing is rejected.
6. **Data-availability seam (producer field ↔ consumer render).** For every AC
   that renders, charts, plots, aggregates, or otherwise *derives a shape from*
   another story's data contract (a report / DTO / response model), trace each
   datum the derivation needs back to the producer contract's **declared fields**
   — **even when the producer is new in this same spec.** Phase 2 grounds "X has
   field Y" against existing source; when both the producer contract and the
   consuming AC are forward-referenced in the same spec, Phase 2 has nothing to
   diff against, so this is the **only** phase where the two new contracts get
   reconciled. Flag any consumer AC whose visualization/derivation names data the
   producer never emits:
   - a **distribution / histogram** chart over a contract exposing only summary
     percentiles or aggregates (no samples, bins, or raw series);
   - a **time-series / bands / equity-curve** chart over a contract exposing only
     per-bucket scalar summaries (no per-step series);
   - any derived field (`producer.foo`) absent from the producer's declared shape.

   Resolution is either **enrich the producer** (add a story/AC that emits the
   required samples/series) or **descope the consumer AC** to the data that exists
   — naming the real datum ("renders a p5/p50/p95 percentile strip") instead of a
   data-rich chart type ("renders the distribution histogram"). Rationale: the
   implementer cannot fabricate the missing data, so the AC ships an honest-but-
   non-conforming render and the story deadlocks in semantic/adversarial review
   (the backtest-robustness US-005 failure mode). Note the trap: such an AC often
   passes its own `[unit]` test (a `data-testid` element is present) yet fails the
   semantic reviewer, which reads the AC's literal noun ("histogram", "bands").

**Blocker:** missing behavioral seam AC for a new exported symbol; seam AC that
triggers an intermediate helper below the wiring instead of the named outermost
entry point (seam-altitude violation); a render / derivation AC that consumes data
absent from the producer contract's declared fields (data-availability seam);
removal-keyword match without a build/static-gate verification note (or encoded as
a file-content AC); mixed additive+destructive story; sizing breach.

### Phase 9 — PRD fidelity (only when `--prd` is passed)

Loads `prd.json` and diffs it against the spec to detect drift introduced by
the planner step (e.g. `nax plan`, or any tool that decomposes a spec into a
PRD). The host project may have a finding documenting prior drift (in the nax
repo, see `docs/findings/nax-plan-prd-fidelity.md` — the US-005 case study
that drove this phase).

Checks:

1. **Spec AC → PRD AC mapping.** Every spec AC must map to ≥1 PRD AC across the
   PRD's `userStories[].acceptanceCriteria`. Use semantic similarity + symbol
   overlap; surface low-confidence matches for human review.
2. **Behavioural fidelity.** Each PRD AC must remain a runtime test the agent can
   implement — same symbol, same inputs, same expected output/exception/invocation
   as the spec AC. Flag any PRD AC the planner rewrote into a file-content / grep
   assertion ("file contains X"), into a vaguer behaviour, or that dropped the
   asserted arguments. A grep-style PRD AC is a regression even if the spec was
   behavioural.
   **Signature reality check:** when a PRD AC (or the spec AC it maps from) names
   a call with explicit arguments against an **existing** interface/function, diff
   the arity and parameter shapes against the real signature captured in Phase 2.
   Planner/acceptance-test generators have hallucinated signatures that contradict
   both the published interface and the spec prose (real case: a generated
   acceptance test called a 2-arg `checkAndReserve(key, ttl)` with 5 args and a
   2-arg `increment(key, windowSeconds)` with 3 — the tests could never pass
   against a correct implementation). A PRD AC whose asserted call shape
   contradicts the real signature is a **blocker**.
3. **Orphan PRD ACs.** PRD ACs with no traceable spec source are flagged as
   scope bleed — typically from `nax plan`'s candidate-PRD merge feature.
   Common signatures: PRD AC introduces new enum values, new status codes, new
   config keys, or new validation behaviour not in the spec.
4. **File-role delta (`contextFiles` vs `expectedFiles`).** The nax PRD splits a
   story's files into two roles with **different semantics** — do not conflate
   them (see [§PRD file-role schema](#prd-file-role-schema-phase-9)):
   - `contextFiles` = files the agent **reads** for context. They exist by the
     time **this story** runs — already on disk, or created by an **upstream
     dependency** that runs first. Maps from the spec story's **`Context Files`**.
   - `expectedFiles` = files **this story** creates. Maps from the spec story's
     **`Creates`**.

   Checks:
   - **a. `Creates` → `expectedFiles`.** Each file in the spec story's `Creates`
     list (files **this** story authors) should appear in that story's PRD
     `expectedFiles`, never `contextFiles`. A self-created file placed in
     `contextFiles` is a **blocker** — at this story's own runtime the file does
     not exist, so it emits a missing-context warning and the create-intent hint
     is lost.
   - **b. `Context Files` → `contextFiles`, gated on existence.** Each spec
     `Context Files` entry that **exists on disk** should appear in the PRD
     `contextFiles`. A genuinely-existing context file that was dropped is a major.
   - **c. Cross-story produced files belong in the consumer's `contextFiles`.**
     A file that is absent on disk because an **upstream dependency** story creates
     it (it's in a prior story's `Creates` / `expectedFiles`) **exists at this
     story's runtime** — dependencies run first (sequential: shared workdir;
     parallel: each batch merges to `HEAD` before the next branches from it). So:
     - In the consumer's `contextFiles` (planner kept it) → **correct, not a
       finding.**
     - Dropped from the consumer's `contextFiles`, **or** mis-moved into the
       **consumer's** `expectedFiles` (the consumer does not author it) →
       **fidelity finding (major):** the spec listed it as a read; the PRD lost or
       corrupted the read hint. Remediation is upstream — `nax plan`'s
       `normalizeCreatedContextFiles` must keep upstream-produced files in
       `contextFiles` (it now consults the dependency graph). Do **not** hand-edit
       the PRD against a planner that would re-strip it; flag the planner.
       Confirm the producer relationship by checking the file appears in an
       upstream dependency's `Creates`/`expectedFiles` before flagging.
   - **d. Helpful additions.** Extra **existing** files the planner added to
     `contextFiles` that aren't in the spec are a minor (usually useful context),
     not a blocker.
5. **Meta-AC survival.** Spec meta-ACs (architectural invariants) must survive —
   either as a runtime PRD AC or as a build/static-gate verification note. Silent
   deletion is a blocker.
6. **Sub-slice cleanup story.** If the spec has a terminal-cleanup story, the
   PRD's last story must be deletion-only (no additive ACs), and its removals must
   carry the build/static-gate verification note — not be re-encoded as
   file-content "does not contain" ACs.

**Blocker:** spec AC missing from PRD; behavioural AC degraded into a
file-content/grep AC or stripped of its asserted behaviour; meta-AC deleted;
orphan PRD AC introducing material scope; terminal-cleanup story missing or
contaminated with additive ACs; a self-`Creates` file placed in `contextFiles`
instead of `expectedFiles`.

**Major:** an upstream-dependency-produced file the spec listed under a consumer
story's `Context Files` that the PRD dropped from `contextFiles` or mis-moved into
the consumer's `expectedFiles` (the read hint was lost or corrupted; the run still
proceeds because the file exists at runtime, so it is a major, not a blocker —
see §4c).

**Not a finding:** an upstream-produced file correctly **kept** in the consumer
story's `contextFiles` (it exists at that story's runtime because the producer ran
first). A self-created file absent from `contextFiles` because it is correctly in
the same story's `expectedFiles` is also not a finding.

**Output:** writes `prd-fidelity-report.md` in the same directory as `prd.json`
(e.g. `.nax/features/<feature>/prd-fidelity-report.md` for nax projects),
listing each spec AC, its PRD destination (or absence), and any behavioural drift.
This artefact is the gate that should run **after** the planner step and
**before** the first story executes.

## Operational rules

### PRD file-role schema (Phase 9)

A nax `prd.json` story carries **two** file lists with distinct semantics. Phase 9
must respect the split. The discriminator is **runtime existence relative to
dependency order**, not plan-time existence:

| PRD key | Meaning | Existence at **this story's runtime** | Maps from spec | Verify with |
|---|---|---|---|---|
| `contextFiles` | files the agent **reads** for context | on disk (already present, or created by an upstream dependency) | story `Context Files` | `ls`, or check upstream deps' `Creates` |
| `expectedFiles` | files **this story** creates | created by this story | story `Creates` | absent before the story runs |

A missing `contextFiles` entry at runtime is a **warning** (`Relevant file not
found`), not a hard error — the run continues. See
`docs/architecture/spec-to-prd-pipeline.md` in the host nax repo for the full
model.

Consequences for the audit:
- A spec `Context Files` entry produced by an **upstream dependency** story
  **belongs in** the consumer's `contextFiles` — it exists at the consumer's
  runtime because dependencies run first (sequential: shared workdir; parallel:
  each batch merges to `HEAD` before the next branches). If the planner kept it,
  that is correct. If the planner **dropped** it or **mis-moved** it into the
  consumer's `expectedFiles`, that is a fidelity finding — the fix is in
  `nax plan` (`normalizeCreatedContextFiles` is now dependency-aware), not a
  hand-edit. Confirm the producer link (file is in an upstream dep's
  `Creates`/`expectedFiles`) before flagging.
- A file **this story** creates belongs in `expectedFiles`. Finding it in the same
  story's `contextFiles` is a blocker.

### Project rule discovery (mandatory before Phase 3)

Run both `ls .nax/rules/` and `ls .claude/rules/` from the project root. Load every `.md` file under each directory that exists. Build an in-memory list of:
- Forbidden patterns (search for tables under headings containing "Forbidden", "Banned", "Anti-Pattern")
- Required patterns (search for tables under headings containing "Required", "Mandatory", "Convention")
- File-location rules (extract paths from "lives at" / "located in" / "owned by" phrases)

**Precedence — nax rules win.** `.nax/rules/` is the canonical, agent-neutral SSOT: per-agent shims (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) are generated one-way *from* it (`nax rules export`), and `.claude/rules/` is a Claude-specific layer (a migration source for `.nax/rules/`, not a generated output). When both stores exist, apply this order (higher wins on conflict):

1. `.nax/rules/*.md` — **highest priority** (nax-native canonical store)
2. `.claude/rules/*.md` — Claude-specific supplement; overridden by a conflicting `.nax/rules/` directive.

nax rule files are path-scoped via frontmatter (`paths`, `appliesTo`, optional `priority`); when a spec code block targets a specific package/path, prefer the rules whose `paths`/`appliesTo` match it.

If neither store exists, fall back to a minimal default rule set: no `JSON.parse` on LLM output, no hardcoded secrets, no `console.log` in source. Note in the report that project rules were not found.

### Symbol extraction (Phase 1)

From the spec, extract every backtick-quoted identifier matching:
- File paths: contains `/` and a file extension (`.ts`, `.tsx`, `.py`, `.go`, etc.)
- Function/method: ends with `(` or `()`
- Type/interface: starts with uppercase, no parens
- Constant: ALL_CAPS or all-lower-snake
- Config key: dotted path like `config.plan.mode`

For each symbol, run a verification grep:
```bash
grep -rn "<symbol>" src/ test/ 2>/dev/null | head -5
```

Cross-reference results against the spec's "New code" / "Remaining work" table. Anything not found in either place is a Phase 1 blocker.

### Shape verification (Phase 2)

For each interface/type referenced in the spec's code blocks, locate the actual definition and diff field-by-field. Pay specific attention to:
- Field optionality (`?:` vs `:`)
- Default values (`.default(X)` vs `.optional()`)
- Discriminated union variants
- Array element types (`string[]` vs `Array<{ text: string; ... }>`)

For each function signature, locate the actual signature and diff:
- Parameter count and order
- Return type
- Whether async / sync
- Generic type parameters

### Stop-the-line gate

After each phase, if there are blockers, halt and produce the partial report. Do not continue to subsequent phases — they may produce false positives based on incorrect spec claims that subsequent revisions will fix.

## Output format

Produce a single markdown report:

```markdown
# Spec Review — <spec path>
**Reviewed against:** <project root> at <git short SHA>
**Date:** <YYYY-MM-DD>
**Phases run:** <N of 9> (<reason if halted>; phases 7-9 conditional — see Workflow)
**Verdict:** ✅ ready / ⚠️ revisions needed / ❌ major rework

## Summary
- Phase 1: <N blockers, M majors, K minors>
- Phase 2: <...>
- ...

## Phase 1 — Symbol Existence

### Blocker — <symbol name>
**Spec reference:** <section> line <N>
**Codebase reality:** <what grep found, or "not found">
**Recommended fix:** <one sentence>

### Major — <...>
...

## Phase 2 — Shape Audit
...

## Recommendations
1. <Most-impactful fix>
2. <Next>
...
```

Each finding must include:
1. **Severity** — blocker / major / minor (defined below)
2. **Spec reference** — section name + line number when possible
3. **Codebase reality** — what was found (or not) and where
4. **Recommended fix** — one sentence, actionable

### Severity definitions

- **Blocker** — implementation will fail at runtime or compile time as specified. Examples: referenced symbol doesn't exist; proposed interface shape contradicts actual type; forbidden API used in a code block.
- **Major** — implementation will run but produce wrong behavior or violate conventions. Examples: wrong session role kind, missing exhaustedFallback on strict-parse run-kind op, AC count over cap.
- **Minor** — cosmetic, documentation, or non-load-bearing inconsistency. Examples: stale revision artifact that doesn't affect behavior, story name drift, missing line numbers in references.

## Worked example

See [examples/asymmetric-pipeline-walkthrough.md](examples/asymmetric-pipeline-walkthrough.md) for a complete walkthrough showing what this skill catches on a real spec (the asymmetric-pipeline proposal pre-revision).

## What this skill is NOT

- **Not a design reviewer.** Does not judge architecture quality. Use `architect` or `code-reviewer` for that.
- **Not a substitute for spec-writing.md.** Validates a written spec; does not author one.
- **Not project-specific.** Rules come dynamically from the project's rule store(s) — `.nax/rules/` (nax-native canonical store, higher priority) and/or `.claude/rules/`. Same skill works on TypeScript, Go, Python, Java projects with different rule sets.

## Cost & cadence

A baseline phases 1-6 run on a 500-line spec is roughly 50–150 grep/read tool calls plus one LLM pass for Phase 4 — approximately 20–40k tokens. Phases 7-8 add ~10-30 grep calls; phase 9 (PRD audit) adds one focused LLM pass plus per-AC similarity matching (~20-50k tokens depending on PRD size). Use this skill:

- **On demand** when explicitly invoked
- **Before** opening the first story of a multi-story implementation (phases 1-8)
- **Immediately after `nax plan` completes** with `--prd <path>` — this is the load-bearing gate that catches spec→PRD drift before any code is written (phase 9)
- **In CI** as a pre-merge check on `docs/specs/**` changes (run phases 1, 3, 5, 7, 8 only — cheaper subset)

Do not run on every save during spec drafting.

## When phases 7-9 are mandatory

- **Phase 7** runs whenever the spec carries AC mechanism tags (`[unit]` / `[integration]` / `[cli]`), or whenever the host project has adopted the verification-anchor convention. The `[grep]`, `[file]`, and `[verbatim]` tags are **deprecated and banned** — flag every occurrence as a blocker and rewrite the AC into a runtime behaviour (or, for removals, a build/static-gate note).
- **Phase 8** runs whenever the spec contains removal keywords (`delete|remove|consolidate|retire|rename`), introduces new exported symbols (interfaces, ops, builder methods), has a story with both additive and destructive ACs, or has any AC that renders/charts/aggregates data from another story's contract (triggers the data-availability seam check).
- **Phase 9** runs whenever `--prd <path>` is passed. Without `--prd`, phase 9 is skipped silently.
