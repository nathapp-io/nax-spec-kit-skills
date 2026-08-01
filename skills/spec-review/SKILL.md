---
name: spec-review
description: Use this skill to systematically review an implementation spec against the actual codebase before handing it off to implementers. Catches API hallucination (named symbols that don't exist), PRD↔code contradictions (proposed shapes incompatible with real schemas/types), existing-test contract collisions (a closed-world assertion an unrelated story's shape change necessarily breaks, deadlocking the run), convention violations (forbidden patterns, wrong file locations, unknown session roles), behavioral semantic drift (spec prose vs actual code behavior), sizing breaches (AC caps), out-of-scope sections written in a shape `nax plan` cannot extract, stale references from earlier revisions, and (when --prd is passed) spec-to-PRD fidelity loss after `nax plan` (including dropped out-of-scope statements). Invoke when the user asks to "review this spec", "check this spec against the codebase", "audit this spec for hallucination", "audit the PRD against the spec", or `/spec-review <path>`. Project-agnostic — loads `.nax/rules/` (nax-native, higher priority) and `.claude/rules/` dynamically.
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
- Spec is for greenfield code with no existing codebase to ground against — Phase 1/2/3 produce noise (but Phase 8's contract-seam check still applies: it reconciles the spec's *own* new producer/consumer contracts against each other, not against code)
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

For every claim of the form "X has field Y" or "X(args) returns Z", open the actual source and compare. Includes interface field membership, function signatures, default values, enum members. Also runs the inverse check — **existing-test contract collision**: when the spec mutates a shape that already exists (a table column, enum member, registry entry, payload key, signature parameter), sweep the test tree for *closed-world* assertions over that shape — set equality, exact object equality, exact counts, snapshots, exhaustive case lists, and loops driven by the shape's *actual* members (which fail as a lookup error, not an assertion diff, and typically hide behind one of the others in the same test). Any such assertion breaks the moment the member is added, and test-authorship isolation bars the implementer from editing a test its story does not own, so the story deadlocks with a correct implementation and gives up.

**Blocker:** any structural claim contradicted by code (e.g. spec proposes per-AC `verifiedBy` but `acceptanceCriteria: string[]`); any closed-world assertion over a shape the spec mutates, where no AC and no `Modifies` entry authorises the implementer to update that test (an out-of-scope deferral does not clear it — the gate still fails).
**Output:** a list of corrections the spec needs.

### Phase 3 — Convention audit

See [checklists/phase-3-convention-audit.md](checklists/phase-3-convention-audit.md).

Load every rule file under the project's rule store(s) — `.nax/rules/` (nax-native canonical store, **higher priority**) and `.claude/rules/` — and apply forbidden-pattern / required-pattern checks against the spec's code blocks. On conflict, a `.nax/rules/` directive overrides a `.claude/rules/` one. Project-agnostic: rules come from the project, not hardcoded.

**Blocker:** any forbidden pattern in the spec, any required pattern missing where required.

### Phase 4 — Behavioral semantic check

See [checklists/phase-4-behavioral-semantic.md](checklists/phase-4-behavioral-semantic.md).

The only LLM-judgment phase. For each named check/function the spec describes behaviorally, open the actual implementation and confirm prose matches code semantics. Also runs three completeness checks: **unpinned failure-handling rows** (a Failure Handling row with no covering AC and no out-of-scope entry — the planner authors it instead, so the spec loses control of wording that Rule 2 makes load-bearing), **under-specified input classes** (an input dimension no AC pins and no Out-of-scope entry defers) and the **adversarial-scope gap** (a risk-sensitive story — auth, rate limiting, replay/MFA, idempotency/dedup stores, tenancy, concurrency, expiry, crypto — that leaves any canonical risk property of its domain neither pinned by a property-style AC nor named in an Out-of-scope entry; checked **per-property**, so a present-but-partial Out-of-scope section does not cover the properties it stays silent about; a predictable adversarial-review deadlock, flagged major).

**Blocker:** spec prose describes different semantics than the code implements (e.g. "rejects uncited PRD claims" when the code measures manifest verification rate).
**Major:** under-specified input class; adversarial-scope gap on a risk-sensitive story; a `### Failure Handling` row with neither a covering AC nor an out-of-scope entry (the planner authors it instead, in its own words).

### Phase 5 — Sizing & hygiene

See [checklists/phase-5-sizing-hygiene.md](checklists/phase-5-sizing-hygiene.md).

Mechanical: AC counts per story, story counts, duplicate detection, story name ↔ body alignment, dependency DAG validity, required sections present, and **`## Out of Scope` machine-extractability** (recognised heading, one self-contained bullet per exclusion — `nax plan` parses this section into `prd.outOfScope`, and an unrecognised shape is silently dropped).

**Blocker:** AC count exceeds project cap (load from `config.precheck.storySizeGate.maxAcCount` or default 15).
**Major:** missing required section; a deferral stated only in prose with no extractable `## Out of Scope` section.

### Phase 6 — Stale-reference sweep

See [checklists/phase-6-stale-references.md](checklists/phase-6-stale-references.md).

For every "already shipped" / "DONE" / "MODIFY (additive)" claim, verify against current state. Catches revision artifacts.

**Blocker:** claims that contradict observable git state.

### Phase 7 — Verification-anchor lint

See [checklists/phase-7-verification-anchor-lint.md](checklists/phase-7-verification-anchor-lint.md).

Classify every AC's verification mechanism. Only **runtime** tags are valid — `[unit]`, `[integration]`, `[cli]`; `[grep]`, `[file]`, and `[verbatim]` are deprecated and banned. Checks that each AC is a real runtime test an implementer can write fail-first, that no AC is a file-content / shell assertion, that a new exported symbol carries a behavioural seam AC, that removals route to the build/static gate rather than an AC, and that every AC carries a **locus token** a reviewer could quote verbatim. Note the tags themselves do not survive `nax plan` (~97% are stripped), so the mechanism must also be legible from the AC's prose.

**Blocker:** missing/invalid mechanism; `[grep]`/`[file]`/`[verbatim]` tag; file-content or shell AC; unpaired new exported symbol with no behavioral seam AC; removal/absence encoded as an AC; unbacked meta-AC.
**Major:** AC with no locus token.

### Phase 8 — Seam & deletion audit

See [checklists/phase-8-seam-deletion-audit.md](checklists/phase-8-seam-deletion-audit.md).

Walks Design and Stories for producer/consumer seams and removal patterns. Every new exported symbol needs a behavioural seam AC triggered at the **outermost production entry point** (seam altitude), guarded wiring needs a re-trigger AC, and a seam AC whose two endpoints **both already exist** must have its claimed call path verified against current code (**seam-path reality**, Class A/B). Also covers "replaces X" wiring, the removal-keyword sweep, deletion isolation, sizing, and **contract seams** in both directions — what a site *reads* must be emitted and reachable (missing producer field, unsourced parameter/threshold/config value), and what it *sends* across a re-encoded boundary must match the producer's declared input shape.

**Blocker:** missing behavioral seam AC for a new exported symbol; seam-altitude violation; Class B seam AC whose entry point does not reach the stubbed symbol, reaches it only behind a guard nothing in the spec establishes, or does not reach the named method; a derivation AC consuming data absent from the producer contract, or needing an input with no source in scope at the site; removal-keyword match without a build/static-gate note; mixed additive+destructive story; sizing breach.

### Phase 9 — PRD fidelity (only when `--prd` is passed)

See [checklists/phase-9-prd-fidelity.md](checklists/phase-9-prd-fidelity.md).

Diffs `prd.json` against the spec to detect drift introduced by `nax plan`: AC survival and behavioural degradation, story/dependency mapping, context-vs-expected file placement, meta-AC survival, **correction survival** (a spec-review correction must reach a `description` or an `acceptanceCriteria` entry — `analysis`, `storyPoints`, and `tags` are read by nothing and are not evidence), **PRD-AC satisfiability** (re-run the Class B trace over PRD invocation ACs, since `nax plan` splits compound ACs that Phase 8 never saw), out-of-scope preservation including the `US-00N only:` prefix rule, and terminal-cleanup integrity.

**Blocker:** spec AC missing from PRD; behavioural AC degraded or stripped of its assertion; meta-AC deleted; orphan PRD AC introducing material scope; terminal-cleanup story missing or contaminated; self-`Creates` file in `contextFiles`; spec out-of-scope statement missing, inverted into an AC, or contradicted by a story.
**Major:** upstream-produced `Context Files` entry dropped or mis-moved; a story-scoped deferral hoisted without a `US-00N only:` prefix; a correction present only in `analysis`.
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
- **Phase 8** runs whenever the spec contains removal keywords (`delete|remove|consolidate|retire|rename`), introduces new exported symbols (interfaces, ops, builder methods), **contains any seam AC whose stubbed symbol and named entry point both already exist** (triggers the Class B seam-path reality check — note this condition is independent of the new-symbol one, since a pure extension spec introduces no new exports yet can still assert a false call path), has a story with both additive and destructive ACs, or has any AC (or `Interface` formula an AC rests on) that **derives a value** — renders, charts, aggregates, counts, filters, ratios, threshold-gated totals — from any producer contract, whether another story's, new in this spec, or existing code, or has any AC where a site **submits** a payload across a boundary it does not own — HTTP body/query, event or queue message, RPC args, subprocess argv, a file another component parses (both trigger the contract-seam check).
- **Phase 9** runs whenever `--prd <path>` is passed. Without `--prd`, phase 9 is skipped silently.
