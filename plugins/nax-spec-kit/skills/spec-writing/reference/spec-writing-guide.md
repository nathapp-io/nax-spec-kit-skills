# Spec Writing Guide

How to write specs that produce high-quality PRDs and successful nax runs.

## Structure

A good spec has 6 sections. **All are required.**

```markdown
# SPEC: [Feature Name]

## Summary
One paragraph: what this feature does and why it matters.

## Motivation
What problem does this solve? What's broken or missing today?

## Design
Key interfaces, data flow, or architecture decisions.
Include TypeScript signatures when defining new APIs.
For CLI tools: specify exit codes, stdout/stderr behavior, and file formats precisely.

## Out of Scope
What this feature deliberately does NOT do — one bullet per deferred item.

## Stories
Break the feature into implementation units.
Each story should be independently testable.
Include context files and dependency markers (see below).

## Acceptance Criteria
Per-story behavioral criteria (see format below).
```

### `## Out of Scope` — machine-extracted, write it to the contract

This section is not prose for human readers. `nax plan` parses it deterministically
into the PRD's top-level `outOfScope` array, backfills anything the planner dropped,
and copies the result onto every story — which is how a deferred arc reaches the
implementer at all. **The implementer never sees the spec.** A statement that is not
in this section, in this shape, does not reach it.

| Rule | Why |
|:---|:---|
| Title the section `Out of Scope`, `Non-Goals`, or `Not in scope` | Any other title is not recognised and the whole section is dropped. Case, `-`/space variants, a trailing colon, surrounding `**bold**`, and setext underlining are all tolerated |
| **One bullet per deferred item** — `- <statement>` | Each bullet becomes one entry; a paragraph packing three exclusions becomes one unreadable entry. `-`, `*`, `+`, `1.` and `•` all work. A table works too: each data row becomes one item (`cell — cell`), the header row is skipped |
| Each bullet must be **self-contained** — name the thing, not "the above" or "this" | The implementer reads the bullet with no surrounding spec context |
| Keep it to **25 items or fewer** | The cap keeps exactly 25 and is document-wide (all sections plus inline markers combined); anything past that is truncated, and it is a signal the feature is too large |
| **Never phrase an exclusion as an acceptance criterion** | It describes work NOT to do; an AC is work to verify |

Safely ignored, so do not work around them: fenced code blocks inside the section, a
`None.` / `N/A` placeholder, and a trailing-colon lead-in above a list. **Not**
recognised: prose that merely mentions being out of scope ("diff rendering is out of
scope here") — it must be a section or a bold lead-in.

Two inline-marker forms work: text on the marker's line, and a bare `**Out of scope:**`
on its own line with bullets beneath. Do **not** put `*`/`_` emphasis inside the marker
— `**Out of scope (see *note*):**` is unrecognised and the whole declaration is lost.

One trap: `None.` / `N/A` / `TBD` are filtered as "nothing deferred", but
`Nothing is deferred.` is not — it becomes a real entry rendered to every implementer as
a hard boundary. Write a bare `None.`

**Feature-level vs story-level — where you put it decides what it means.**

`nax plan` extracts a declaration into `prd.outOfScope` (and copies it onto *every*
story) only when it is a top-level `## Out of Scope` section — anywhere in the document
— or an inline `**Out of scope (deferred):** …` lead-in appearing **before** the first
`## Stories` / `## Acceptance Criteria` heading. A bold lead-in *after* the story
sections begin reaches no story at all.

A `**Out of scope:**` block under a story's AC block is **story-scoped** and deliberately
not extracted — hoisting it would tell US-001's implementer that US-002's deferred work
is a hard boundary. But know the cost: nothing deterministic carries a story-local block
into `prd.json`. The planner is *asked* to fill the story's `outOfScope` and usually
does, but there is no backfill, and the adversarial reviewer only ever sees
`story.outOfScope`. If the planner omits it, the property you thought you deferred is
silent again — the exact condition Rule 10 exists to prevent.

So for a risk property you are deferring: keep the story-local block (spec-review Phase 4
reads it), and **if an adversarial reviewer would plausibly block on the property, also
add a feature-level bullet naming the story** — `- US-002 only: write-back atomicity is
deferred to arc 3`. That path is guaranteed.

**The `US-00N only:` prefix is mandatory on every hoisted bullet, not a formatting
nicety.** The feature-level list is denormalised onto *every* story, so an unprefixed
hoist silently imposes one story's waiver on all of them — and the adversarial reviewer
can cite it to close a legitimate finding in a story the waiver never covered.
spec-review keys on the prefix: prefixed hoists are accepted, unprefixed ones flagged. A
deferral that genuinely applies feature-wide is written without a prefix — a different,
and fine, statement.

## Acceptance Criteria Format

Every AC must be **behavioral and independently testable**.

### Use This Format

```
- [function/method] returns/throws/emits [specific value] when [condition]
- When [action], then [expected outcome]
- Given [precondition], when [action], then [result]
```

### Rules

1. **One AC = one assertion.** If an AC has "and" in it, split it.
2. **Use concrete identifiers.** Function names, return types, error messages, log levels. This is a convergence control, not a style preference: **AC text is the only surface a downstream reviewer can ground a blocking finding against.** An `error`/`critical` finding is dropped unless its quote is a verbatim substring of the AC it cites *and* contains a locus keyword (a symbol, file basename, route, command, or error name). So a vague AC is a **wide** quote surface — nearly any objection can be grounded against it, and the story loops in adversarial review; a specific one naming a concrete locus is **narrow**, and off-target findings are dropped mechanically. Every AC should carry at least one identifier a reviewer would have to quote verbatim.
3. **Specify HOW things connect.** "logger forwards to the run's logger" not "logger exists".
4. **Never list quality gates.** Typecheck, lint, and build are run automatically — don't waste ACs on them.
5. **Never use vague verbs.** "works correctly", "handles properly", "is valid" are untestable.
6. **Never write ACs about tests.** "Tests pass" or "test file exists" are meta-criteria, not behavior.
7. **Stay in scope.** Only write ACs for behavior described in the spec. Don't invent features not in the requirements.
8. **Be consistent.** If the spec says "url", don't use "uri" in interfaces. Match terminology exactly.
9. **Pin every meaningful input class.** When an AC covers a function whose inputs split into behaviorally distinct classes — sync vs async, present vs absent, valid vs malformed, empty vs non-empty, resolves-true vs resolves-false — write an AC for **each class the feature handles**, and list any class it does **not** handle under **Out-of-scope**. An input class left undefined by every AC (and unexercised by any AC's test) is undefined behavior: the reviewers over-interpret it in *contradictory* directions, the fix for one reviewer re-triggers the other, and the story never converges (real case: `notif-dlq-hardening` pinned sync-factory behavior in AC3/AC4 but left async factories undefined → an unsatisfiable semantic-vs-adversarial contradiction that burned several escalation tiers). Either pin it or defer it — never leave it silent. This is about the *plausible, behaviorally-distinct* classes a caller will actually hit — not every combinatorial permutation; if pinning them all would breach the story's AC cap, that is a signal to split the story (see Story Sizing), not to pack in more ACs.
10. **Pin every applicable risk property, or declare it out of scope.** When a story's subject matter is risk-sensitive — authentication/sessions, rate limiting/counters, replay protection (TOTP/OTP/MFA/nonce), idempotency/dedup stores (reserve-then-finalize, upsert), multi-tenancy scoping, concurrency/atomicity (check-then-act, upsert, locks), expiry/TTL/retention, crypto/secrets — enumerate that domain's canonical risk properties (window expiry and atomic increment for rate limiters; reuse-within-window rejection for replay stores; atomic compare-and-set on the finalize/upsert write-back for reserve-then-finalize stores; tenant scoping on every read/write; expired-row exclusion; etc.) and for each one either write an executable AC or list it under **Out-of-scope** with a one-line reason. **Coverage is per-property, not per-story: a present Out-of-scope section covers only the properties it names.** A store that defers tenancy and eviction but stays silent on finalize atomicity has still left that property silent, and it will block. A risk property left silent is contested territory for the adversarial reviewer, which runs last on green code and can substantiate factually-true findings about the unpinned property while quoting an adjacent AC verbatim — every such finding survives AC-grounding and blocks, round after round (real case: an IAM-store story with 7 happy-path passthrough ACs looped ~18 adversarial rounds on atomic windows, TOTP replay derivation, and tenant nullability that no AC mentioned). The out-of-scope route is legitimate and cheap; the point is that the **spec** owns the scope boundary, not a downstream reviewer.
    Canonical properties by domain — match on the story's *subject matter* (title, design
    touchpoints, symbols), not incidental word use:

    | Risk-sensitive domain (trigger keywords) | Canonical risk properties to pin or declare |
    |:---|:---|
    | Authentication / sessions (`auth`, `login`, `token`, `session`) | credential validation on every path; expiry honored; failure states distinguishable |
    | Rate limiting / counters (`rate limit`, `attempt`, `counter`, `window`) | window expiry/reset; atomicity under concurrent increment |
    | Replay protection (`replay`, `nonce`, `TOTP`, `OTP`, `MFA`) | time-step/window derivation; reuse-within-window rejected |
    | Multi-tenancy (`tenant`, `org`, `workspace` scoping) | every read/write scoped by tenant; tenant field required, not nullable |
    | Concurrency / atomicity (`race`, `lock`, `transaction`, `upsert`) | check-then-act paths atomic or explicitly declared best-effort |
    | Expiry / retention (`TTL`, `expiresAt`, `retention`) | expired rows excluded from reads; cleanup semantics |
    | Crypto / secrets (`hash`, `encrypt`, `secret`, `key`) | algorithm/strength named; secrets never logged or returned |

11. **Pin every failure-handling row, or declare it out of scope.** Every row in the spec's `### Failure Handling` design subsection (or `## Failure Modes` prose) must produce at least one AC in the story that owns it, or appear in that story's **Out of scope** with a one-line reason. `nax plan` treats a failure-mode row without an AC as a *missing* AC and authors one itself — so the criterion ships either way; the only question is whether you or the planner chose its wording. That matters because AC text is the reviewer's quote surface (Rule 2): a planner-authored failure AC is one you never got to put a locus token in. Observed leak — `short-selling` (+3), `sp4-mfa-step-up` (+3), and `cost-ledger` (+1) each gained planner-written failure-path ACs traceable to Failure Handling prose the spec never encoded.

    **Non-goal — do not invent edge cases to pin.** This rule covers rows the design *already states*. Behavioral edge cases and negative paths you have **not** thought of are what the planner's `suggestedCriteria` channel and its hardening pass exist to surface: they are advisory, and are promoted into `acceptanceCriteria` only after they pass. Pinning a speculative case converts a safe suggestion into a blocking criterion that is permanently red if you guessed wrong, and spends AC budget against the story's cap. Pin what the spec states; leave what it does not to the hardening pass.

12. **Pin every design mandate that names an API, or make the prose non-normative.** Design prose that constrains *how* the implementation must work by naming a specific symbol, API or call order — a "Library APIs used:" list, "X goes through `foo()` directly", "project through A, **not** `B`", a numbered call sequence — is a normative contract, not commentary. For each such mandate, do one of three things in the story that owns the touchpoint: write an AC that pins the call observably, rewrite the prose non-normatively ("any converter that maps an index to a pixel"), or name it in that story's **Out of scope**.

    Why this one deadlocks rather than merely leaking wording. `nax plan` copies design prose into the story's `description`, so semantic review can quote the mandate verbatim — while no test can reach it, because no AC named it. The implementer picks a different-but-plausible API, every gate goes green, and semantic blocks on the prose round after round. Rectification then thrashes between API shapes, and the story exits on a bail predicate rather than a verdict. Unlike Rule 11, the planner does **not** rescue this: it authors ACs for failure-mode rows, not for approach prose.

    **This rule fires on third-party and standard-library APIs too.** Every other "must actually be invoked" guard in this kit — the two-anchor rule, the seam ACs, the Phase 5 unpaired-export blocker — triggers on symbols *this spec* exports. A mandate to use a dependency's API is unguarded by anything else.

    **Mocked-collaborator corollary.** When the story's test harness replaces the mandated collaborator with a test double — an SDK, an HTTP client, a rendering or charting library stubbed wholesale in the unit environment — an AC that asserts only an *outcome downstream of that double* cannot discriminate a conforming implementation from a non-conforming one. The double gets reshaped to whatever the implementation happens to call, and the AC passes either way. Assert on the double's captured calls instead, or give the double the real dependency's contract (including the inputs on which it returns nothing) so the outcome AC becomes discriminating. If the spec's own Design says the dependency is mocked wholesale, this is mandatory, not advisory.

    A prohibition needs the negative to be observable: "through the index, **not** `timeLookup()`" is only pinned by an AC that fails when `timeLookup()` is used — typically a double whose `timeLookup()` returns nothing for the inputs the mandate is about.

### Examples

❌ **Bad:**
- "TypeScript strict mode compiles with no errors" → quality gate
- "Interface defined with all required fields" → existence, not behavior
- "Function handles edge cases correctly" → vague
- "Tests added and passing" → meta
- `registerDlq(factory)` wires the service when `factory` returns `enableProcessor: true` → silent about async factories; leaves the async input class undefined (Rule 9)

✅ **Good:**
- `buildPostRunContext()` returns `PostRunContext` where `logger.info('msg')` forwards to the run logger with `stage='post-run'`
- `getPostRunActions()` returns empty array when no plugins provide `'post-run-action'`
- `validatePostRunAction()` returns `false` and logs warning when `postRunAction.execute` is not a function
- When `action.execute()` throws, `cleanupRun()` logs at warn level and continues to the next action
- `registerDlq(syncFactory)` wires `DLQ_SERVICE` when the **synchronous** factory returns `enableProcessor: true` *(input class pinned — Rule 9)*
- `registerDlq(syncFactory)` throws unknown-provider when the **synchronous** factory returns `enableProcessor: false` *(the sibling class, pinned)*
- Async (`Promise`-returning) factories are **Out-of-scope** for conditional DLQ wiring — declared in the spec's Out-of-scope, not left to reviewer interpretation

## Story Sizing

| Size | ACs | LOC | Files | Guideline |
|:-----|:----|:----|:------|:----------|
| Simple | 3-5 | ≤50 | 1-2 | Single concern, purely additive |
| Medium | 5-8 | 50-200 | 2-5 | Standard patterns, clear requirements |
| Complex | 6-15 | 200-500 | 5+ | New abstractions, multiple modules |

### Hard splitting rules (no exceptions)

**Must split** — these are non-negotiable. The "single story with sub-deliverables"
framing is banned (see Anti-Patterns); it licenses `nax plan` to re-decompose the
spec freely and is the documented cause of the US-005 drift.

- More ACs in one story than the project's `maxAcCount` (resolved in Pre-flight; fallback 15) —
  **counted as assertions, not bullets.** Two corrections to the naive reading:
  - **Count assertions.** `nax plan` atomically splits a compound AC into one AC per assertion, so a
    bullet asserting three things is three PRD ACs. A story that looks like 13 bullets can plan to 21
    (an observed story did exactly that; the feature went 45 → 64, +42%). Split compound
    ACs at authoring time and the spec count matches the PRD count. Independent reason to do it:
    acceptance generates **one test per AC**, so a compound AC yields one test covering several
    assertions — worse coverage and worse failure attribution when it fails.
  - **The cap is per project, and 15 is only a fallback.** Observed values across a sample of real
    projects span **6** to **24** (a small library at 6, application projects at 15, a backend
    platform at 22, a data-heavy project at 24), so the
    generic number is wrong more often than right — always size against the value resolved from
    `.nax/config.json`. A separate `maxBulletPoints` (8–22) caps description bullets. Corpus check:
    6.7% of stories exceed 15 and 0.5% exceed 24, so the ceiling binds rarely — but when it does the
    run fails a precheck rather than degrading quietly.
- Story `Context Files` list has more than 5 entries
- Story contains both additive intent ("add X", "introduce Y") and destructive
  intent ("delete X", "remove Y", "rename X", "consolidate X into Y") — split the
  destruction into a terminal-cleanup story that depends on the additive one
- Story has both "add new feature" and "refactor existing code"
- **(monorepo only)** Story touches more than one workspace package — split into
  one story per package so each story has a single `Workdir` (see Workdir below).
  A repo-root-only story is not a split trigger; it takes `Workdir: .`.

**Terminal-cleanup story rule.** When a spec includes any removal/rename/consolidation
ACs, the last story must be **deletion-only** — no new code, only file deletions,
caller migrations, and import removals. Removals are verified by the build/static
gate (compiler, linter, `bun run typecheck`), not by runtime ACs — record the gate
command in the story's verification note. This prevents the well-known attractor
where additive slices land green and cleanup is silently dropped.

**Merge if:**
- Two stories share the same module and have <4 ACs each
- A story only makes sense as part of another (e.g., "parse schema" is not useful without "validate against schema")

**Target 3-7 stories per spec.** More than 7 usually means stories are too granular — each story should deliver a user-visible capability, not a single function.

## Context Hints (Required)

Every story **must** list relevant context files. Without them, the agent guesses which patterns to follow.

Three distinct lists with three distinct meanings — **never mix them**:

### `Context Files` → files to **read** (exist by the time this story runs)

These are reference files the agent reads before coding. The plan phase populates
`contextFiles` in the PRD from this list; the runtime emits a "Relevant file not
found" **warning** (not a hard error — the run continues) for any entry missing at
the consuming story's runtime.

"Exist by the time this story runs" covers two cases:
1. **Already on disk** — existing reference files (the common case).
2. **Created by an upstream dependency** — a file a story this one `depends on`
   authors. It is absent at plan time but present at this story's runtime
   (dependencies run first: sequential mode shares the workdir; parallel mode
   merges each batch to `HEAD` before the next branches from it). Annotate it with
   its producer so the hand-off is explicit.

```markdown
### Context Files
- `src/plugins/extensions.ts` — existing extension interfaces (follow this pattern)
- `src/plugins/registry.ts` — registry getter pattern to replicate
- `apps/web/components/ProposalCard.tsx` — created by US-002, integrated here
- `test/unit/plugins/registry.test.ts` — existing test patterns
```

**Do NOT list a file _this story_ creates here.** A file the *current* story
authors does not exist at its own runtime, so listing it under `Context Files`
makes the runtime emit a false "Relevant file not found" warning and the
create-intent hint is lost — it belongs in `Creates`. This prohibition is
specific to self-created files; a file an **upstream dependency** creates is a
legitimate read (case 2 above), not a self-create.

### `Creates` → files to **author** (do not exist yet)

New files the story produces. The plan phase maps this list to `expectedFiles`
in the PRD — a post-execution asset gate, NOT a read list. Absence on disk is
expected, so no warning fires; the agent still receives the path as a
"you will create this" hint.

```markdown
### Creates
- `src/validator.ts` — core validation logic
- `src/types.ts` — all interfaces defined in the Design section
```

A file may appear in **`Context Files`** (a sibling to mirror) and **`Creates`**
(the new file itself) across the same story — but a single path belongs to exactly
one list. For a greenfield project with no existing code, a story may have only a
`Creates` list and no `Context Files`.

### `Modifies` → existing files the story is **authorised to change**

An existing file — almost always a test — that this story's own correct change
necessarily breaks. `nax plan` maps this list to `modifiedFiles` in the PRD, and
the implementer prompt renders it as an explicit authorisation block.

Write it whenever the story mutates a shape that an existing closed-world
assertion pins. Without the entry, the implementer that writes a *correct*
implementation and watches an old assertion fail has two moves left: leave the
suite red, or revert its change until the assertion passes. The second has been
observed in the wild. This block is what makes the first unnecessary.

Group entries under a bold `**US-00N**` lead-in — that lead-in is what attributes
the authorisation to a story, and an entry with no group above it is dropped with
a warning rather than applied to every story:

```markdown
### Modifies

**US-001**
- `test/unit/context/engine/orchestrator.test.ts` — the test named "chunkTokens
  covers exactly the included chunks" (`:99-110`) asserts `summed ===
  usedTokens - digestTokens`. Its `BASE_REQUEST` carries no `priorStageDigest`,
  so under US-001 AC 6 the identity no longer holds and the assertion fails
  against a correct implementation. US-001 owns updating it to the new
  invariant: `summed` equals `usedTokens` minus the prior-stage digest tokens.
```

**The reason is the payload, and it is carried verbatim.** Name the file, the
test, the assertion, and the invariant that replaces it. `nax plan` does not
paraphrase this text and the planner is never asked to produce it — the entire
point is the specificity that "update affected engine tests" destroys.

**One file per bullet — never comma-separate several paths into one.** A bullet
yields exactly **one** authorised entry. The extractor takes the *leading*
backticked span as the path and treats **everything after it** as the reason, so
a second path in the same bullet is absorbed into that reason string and never
becomes an entry of its own:

```markdown
<!-- WRONG — one entry; the other two paths are swallowed into the reason -->
- `tests/pricing/totals.test.ts`,
  `tests/pricing/discounts.test.ts`,
  `tests/pricing/rounding.test.ts` — each pins the old two-argument shape.

<!-- RIGHT — three entries, each independently authorised -->
- `tests/pricing/totals.test.ts` — pins the old two-argument shape of the
  price calculator. Replacing invariant: the third argument defaults to the
  currency's minor unit, so existing two-argument expectations still hold.
- `tests/pricing/discounts.test.ts` — same two-argument assumption; same
  replacing invariant.
- `tests/pricing/rounding.test.ts` — same two-argument assumption; same
  replacing invariant.
```

The failure is quiet and survives every green gate: the block still *looks*
authoritative, the stray paths still appear in the rendered prompt as part of a
neighbouring reason, and only the first file of each bullet carries a real
authorisation. Repeating a shared reason across bullets is the correct trade —
this list is permission, and permission does not deduplicate.

A path repeated under **different** stories is legitimate: each story is
separately authorised, with its own reason.

Entries are capped (25 at the time of writing). A spec that needs more has a
scope problem rather than a modification list.

Being listed here is permission, not a task: an implementer touches the file only
if its change actually requires it. And it is not a substitute for an
out-of-scope entry — a deferral does not authorise anything.

## Workdir (monorepo, required)

In a **workspace monorepo** every story **must** declare a `Workdir` — the single
package directory the story operates in, relative to the repo root. `nax plan`
maps it to the `workdir` field in `prd.json`, scoping the implementation session
and quality gates (build/test/lint/typecheck) to that package's
`.nax/mono/<pkg>/config.json`. Without it, the gates run at the repo root and miss
the per-package commands.

Detect a monorepo via any of: `workspaces` in root `package.json`,
`pnpm-workspace.yaml`, a Cargo `[workspace]`, `go.work`, an Nx/Turbo/Lerna config,
or an existing `.nax/mono/` directory.

Rules:
- `Workdir` is **single-valued** — exactly one package path that matches a
  workspace member (e.g. `apps/api`, `packages/core`). A story spanning more than
  one package must be split (see Hard splitting rules).
- A story operating only on repo-root files (root config, workspace manifest,
  top-level tooling) takes `Workdir: .`.
- A newly scaffolded package's stories use that new package's path.
- **Single-package (non-monorepo) repos omit `Workdir` entirely** — do not write
  `Workdir: .` for them.

```markdown
### Stories
1. **US-001: API validation endpoint** — `Workdir: apps/api` — no dependencies
2. **US-002: Web form wiring** — `Workdir: apps/web` — depends on US-001
3. **US-003: Shared validator** — `Workdir: packages/core` — no dependencies
```

See [../examples/SPEC-example-monorepo.md](../examples/SPEC-example-monorepo.md)
for a complete worked monorepo spec with per-package splits and a `Workdir: .`
root-only story.

## Removal & Migration ACs

When a story deletes, renames, consolidates, or replaces existing code, removal
is **not** expressed as an AC. Deleting a symbol is a compile error in statically-typed
languages — the build/static gate (compiler, linter, `bun run typecheck`) is the verification
mechanism. Record the gate command in the story's verification note, not in
`acceptanceCriteria`.

Every story whose summary or design contains "remove", "delete", "consolidate",
"replace", "migrate", or "rename" must include:
- A **verification note** naming the gate command (e.g. `bun run typecheck`, `bun run lint`)
- A **behavioural AC** proving the capability is preserved after the removal

### Example — removal story for `runThreeSessionTdd`

```markdown
**Verification note:** removal verified by `bun run typecheck && bun run lint` —
the compiler rejects any remaining references to deleted symbols.

### Acceptance Criteria
- [integration] behaviour previously covered by `runThreeSessionTdd` is now exercised
  by the migrated tests under `test/integration/execution/`
```

## Seams — wiring producer to consumer

When a story produces a new exported symbol (e.g. `builder.addRectification`)
and a consumer (e.g. `pipeline/stages/execution.ts`) is expected to call it,
the spec must declare a **Seam AC** in the consumer story. Without a seam AC,
multi-slice execution drops the handoff: the producer slice adds the method,
the consumer slice never wires the call, and both slices ship green.

A seam AC is a behavioural `[unit]` or `[integration]` test: stub/spy the new
symbol, trigger the consumer's production path, and assert the symbol was invoked
with the expected arguments. This proves the call site exists *and* is wired.

**Seam altitude — name the entry point, not "the production path."** The trigger
must be the **outermost production entry point a real user or event reaches** —
an HTTP route, CLI command, event `publish`, or scheduled tick — named
concretely, *not* an intermediate helper the feature itself introduces. When any
wiring logic (a guard, a payload mapping, a once-per-transition/dedup check)
sits **between** that entry point and the stubbed symbol, a test entering *below*
it is green-but-blind: it proves *some* caller invokes the symbol, not that the
real trigger does, through the guard. Downstream adversarial review will refuse
to pass such a story, and it deadlocks. Enter the seam test **above** the wiring.

If the wiring is **guarded** (once-per-transition, dedup, idempotency), add a
second seam AC that **re-triggers the entry point and asserts the symbol is NOT
invoked again** — a single-fire assertion cannot detect a missing guard.

❌ **Insufficient — enters below the wiring (the notify-outbound US-005 pattern):**
- `[integration]` call `dispatch_order_event(order, dispatcher)` directly with a
  hand-built row; assert `notify_order_event` invoked once
  *(bypasses the route and the `pre_status` transition-once guard where the
  wiring actually lives — passes green, yet the production path is unproven)*

✅ **Sufficient — enters at the named entry point, above the guard:**
- `[integration]` `GET /api/portfolio/{id}/orders/{id}` with `fetch_order`
  returning `filled`; assert `notify_order_event` invoked once with the order
- `[integration]` re-poll the same order; assert `notify_order_event` is **not**
  invoked again (transition-once guard)

```markdown
### Seams

- [unit] stub `buildPlanForStrategy`; invoke the execution stage; assert
  `buildPlanForStrategy` was called once with the expected strategy argument
- [integration] run the pipeline with a failing full-suite gate configured;
  assert `fullSuiteGateOp` is invoked before the implementer stage
```

Multi-story seams (producer in US-A, consumer in US-B) declare the seam AC in
US-B's ACs and tag both stories with the same seam ID for traceability.

## Verification anchors — two-track ACs

Every AC needs a verification mechanism. Tag each AC with one of:

- `[unit]` — verified by a unit test
- `[integration]` — verified by an integration test
- `[cli]` — verified by running a CLI command and asserting exit code / output

**The two-anchor rule:** ACs verified only by `[unit]` on an isolated function
do not prove the production path is wired. They satisfy the agent's "make
tests green" objective without integrating the change. Pair every `[unit]` AC
that introduces a new exported symbol with an `[integration]` seam AC asserting
the production caller invokes it (see Seams above).

❌ **Insufficient (US-005 AC#3 pattern):**
- `[unit]` "test adds a failing gate and asserts verifier slot does not dispatch"

✅ **Two-track:**
- `[unit]` "test adds a failing gate and asserts verifier slot does not dispatch"
- `[integration]` stub `fullSuiteGateOp`; run the build plan; assert `fullSuiteGateOp` was invoked

## Meta-ACs (architectural invariants)

ACs that assert architectural properties ("adding a new phase requires edits
in three places," "wrapper is read-only over `phaseOutputs`") are not runtime
behaviours an implementer can write as a fail-first test. Route them to the
build/static gate (compiler, linter, `bun run typecheck`) and record the gate command
in the story's verification note — do not encode them as ACs.

❌ **Aspirational AC:**
- "Adding a new phase requires edits in three places"

✅ **Verification note + behavioural AC:**
- Verification note: `bun run lint` — the linter rule enforces the three-site constraint
- `[integration]` add a new phase via `addPhase()`; run the pipeline; assert the phase executes in the correct slot

If you cannot express the invariant as a runtime behaviour an implementer can test, it is not an AC — remove it.

## Dependencies

Mark story dependencies explicitly:

```markdown
### Stories
1. **US-001: Add types** — no dependencies
2. **US-002: Registry support** — depends on US-001
3. **US-003: Runner integration** — depends on US-002
```

nax executes stories in dependency order. Independent stories can run in parallel.

## CLI Tools

When speccing a CLI tool, the Design section **must** include:

1. **Exit codes** — what code means success, what means failure, any special codes
2. **stdout vs stderr** — what goes where (e.g., results to stdout, errors/warnings to stderr)
3. **Output format** — exact shape of output (JSON schema, line format, etc.)

```markdown
### CLI Behavior
- Exit 0: all validations pass
- Exit 1: one or more validation errors
- stdout: validation results (human-readable by default, JSON with `--format json`)
- stderr: warnings (e.g., unknown variables) and fatal errors (e.g., file not found)
```

Without this, the agent invents its own I/O contract and it rarely matches what you expect.

## File Formats

When a feature introduces a new file format (config, schema, data), **specify the exact format** in the Design section. Use a concrete example with every supported field.

❌ **Bad:** "The schema file defines variable types and constraints"

✅ **Good:**
```json
{
  "variables": {
    "PORT": { "type": "number", "required": true, "default": "3000" },
    "DEBUG": { "type": "boolean", "required": false }
  }
}
```

Ambiguous formats → the agent guesses → the tests assert the wrong shape → rectification loop.

**Prefer JSON or YAML** for new file formats. Custom line-based formats (e.g., `KEY=type,modifier`) require the agent to write a parser from scratch — more code, more bugs, more ACs. JSON/YAML parsing is free with standard libraries.

## Extending an Existing System

When a feature extends existing code (not greenfield), the Design section **must** include:

1. **Existing types to extend** — name the exact types, interfaces, or unions the agent must modify. Don't assume the agent knows the codebase.
2. **Integration point** — where does new code plug in? Name the function, stage, or hook.
3. **Existing patterns to follow** — point to a similar feature already implemented as a reference.
4. **First story = types + config** — when adding a new capability to an existing system, the first story should extend the type system and config schema. Implementation stories depend on it.

```markdown
### Integration
- Extend `ReviewCheckName` union in `src/review/types.ts` to include `"semantic"`
- Wire into `runReview()` in `src/review/runner.ts` (same pattern as `"lint"` check)
- Add `SemanticReviewConfig` to `ReviewConfig` in `src/config/runtime-types.ts`
- Follow the same `ReviewCheckResult` return shape as existing checks
```

Without this, the agent invents its own types and wiring — which won't compile against the existing code.

## Implementation Approach

The Design section must state **how** the feature works — not just what it does. If the agent has to guess the approach, it will guess wrong.

```markdown
### Approach
This uses an LLM call (not AST analysis) to review the diff.
```

This is especially critical for features that could be implemented multiple ways (LLM vs regex vs AST, polling vs webhook, sync vs async).

## Failure Modes

Every spec should state what happens when things go wrong:

- **Fail-open vs fail-closed** — does a failure block the pipeline or get logged and skipped?
- **Retry behavior** — does the system retry? How many times? What context does the retry get?
- **Error output** — what does the user see on failure?

```markdown
### Failure Handling
- If LLM response is not valid JSON → fail-open (log warning, treat as passed)
- If review fails → autofix stage retries with findings as context
- If autofix exhausted → escalate (same as lint/typecheck exhaustion)
```

Without this, the agent either ignores errors entirely or adds overly defensive error handling that blocks on non-critical failures.

## Anti-Patterns

| Pattern | Problem | Fix |
|:--------|:--------|:----|
| Giant story (15+ ACs) | Agent gets confused, fails | Split into 2-3 focused stories |
| "Make it work" AC | Untestable | Specify exact behavior |
| Test-only story | Pipeline handles tests | Delete — each story gets tests automatically |
| Doc-only story | Not code | Put in analysis field or skip |
| Quality gate AC | Already automatic | Remove from ACs |
| Vague description | Agent guesses wrong | Include function signatures, types |
| Scope creep in ACs | Agent builds unrequested features | ACs must trace back to a requirement in Summary/Design |
| Ambiguous file format | Agent invents wrong schema shape | Show exact example with all fields in Design |
| Missing CLI contract | Agent guesses exit codes/output | Specify exit codes, stdout/stderr, output format |
| No integration context | Agent invents types that don't fit existing code | List exact types/interfaces to extend in Design |
| Missing implementation approach | Agent guesses wrong method (AST vs LLM vs regex) | State the approach explicitly in Design |
| No failure modes | Agent ignores errors or over-blocks | Specify fail-open/closed, retry, error output |
| Too many stories | Overhead per story; tiny stories are fragile | Target 3-7 stories; merge if <4 ACs each |
| Integration-only story | Duplicates ACs from earlier stories | Integration behavior belongs in the story that implements it |
| Custom file format | Agent writes a fragile parser | Use JSON/YAML unless there's a strong reason not to |
| "Single story with sub-deliverables" | `nax plan` re-decomposes freely and paraphrases load-bearing assertions (US-005 drift) | Pre-decompose into US-Xa/b/c with explicit dependencies — the planner becomes a verification step, not a decomposition step |
| Additive + destructive ACs in one story | Agent ships additive half green, defers cleanup | Split deletions into a terminal-cleanup story that depends on the additive story |
| Test-shape AC (`{ foo: true }` field assertions) | Agent reshapes API to be easy to assert | Write ACs against the contract (plan executes step N before M), not the object shape |
| Shell command or file-content assertion in AC | Not an agent-implementable test; nax has no shell executor | Rewrite as the runtime behaviour the assertion is meant to prove; route removals to a build/static-gate verification note |
| Missing seam AC for producer/consumer pairs | Producer slice ships green; consumer slice never wires call | Add a `[unit]`/`[integration]` seam AC: stub the symbol, trigger the production path, assert it was invoked |
| `[unit]`-only AC for new exported symbol | Isolated test passes; production caller never invokes the symbol | Pair with an `[integration]` seam AC asserting the production wiring |
| Aspirational meta-AC ("only N edit points") | No runtime test an implementer can write | Move to build/static-gate verification note; write a behavioural AC for the observable behaviour instead |
| Novel code shape with no codebase precedent | Agent defaults to nearest familiar template (pattern gravity) | Either cite an existing file with the same shape or include a complete worked skeleton in Design |
| (monorepo) Story with no `Workdir` | Quality gates run at repo root, miss the package's per-package commands | Assign each story a single-valued `Workdir` = its package path (`.` for root-only) |
| (monorepo) Story spanning multiple packages | One `workdir` can't scope two packages' gates | Split into one story per package, each with its own `Workdir` |

## Real Example

**Bad spec (vague):**
> Add config validation.
> Stories: 1) Add validator 2) Wire it in 3) Clean up

**Good spec:**
> See [../examples/SPEC-example.md](../examples/SPEC-example.md) — a complete,
> guide-conformant spec that includes:
> - Interface definitions with signatures (Design § Integration)
> - Per-story behavioural ACs (`[unit]`/`[integration]`) with function names and expected behaviour
> - Context Files pointing to the files each story touches
> - A clear dependency chain (US-001 → US-002 → US-003)
> - A **seam AC** wiring producer to consumer, and a **terminal-cleanup story**
>   whose removal is verified by the build/static gate (no `[verbatim]`/grep ACs)

---

*See also: [../examples/SPEC-example.md](../examples/SPEC-example.md) for the complete worked example.*
