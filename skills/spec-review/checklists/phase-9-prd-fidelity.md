# Phase 9 — PRD Fidelity

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

   **5b. Correction survival — `analysis` is not evidence.** Every correction an
   earlier spec-review round made must reappear in a story's `description` or in an
   `acceptanceCriteria` entry. **Finding it only in `analysis` does not count.**
   `analysis` is rendered into **no** run-time prompt (`story.ts` emits only title,
   `description`, `acceptanceCriteria`, `outOfScope`), so a correction that lives
   there alone reaches nobody. It is planner commentary, not a delivery channel.
   Present in 331/337 PRDs corpus-wide and read by nothing.

   Treat `storyPoints` and `tags` the same way — both are inert (1422/1439 stories
   carry the auto-defaulted `storyPoints: 1`). Never cite any of the three as proof
   that content survived.

   A correction present *only* in `analysis` is a **major**: the wording is not lost
   from the artifact, but it is invisible at run time.

   **5c. PRD-AC satisfiability spot-check.** Phase 8's Class B seam-path rule runs
   against **spec** ACs. `nax plan` atomically splits compound ACs, so a PRD may
   contain invocation ACs that never existed in the spec and that Phase 8 therefore
   never saw. For every `prd.json` AC asserting that some entry point invokes a
   stubbed symbol — where **both** endpoints already exist — re-run the Class B
   trace (see Phase 8 check 1). Same three blocker conditions: no path; path only
   behind an enabling flag nothing in the spec establishes; path reaching the symbol
   but not the named method.

   This is the last gate before `nax run`, and the failure it catches is expensive:
   an unsatisfiable AC becomes an acceptance test named `AC-N: …` that can never go
   green. nax's acceptance diagnosis can only return `source_bug`, `test_bug`, or
   `both` — it has **no verdict meaning "the criterion is wrong"** — so it blames
   innocent code and burns `rectification.maxAttemptsTotal` (default 12) attempts
   plus tier escalation before the story blocks, never naming the real cause.
   Scope: invocation-shaped ACs only, not every AC.
6. **Out-of-scope preservation (`prd.outOfScope`).** The PRD carries a top-level
   `outOfScope` string array holding the spec's `## Out of Scope` / `## Non-Goals`
   statements. `nax plan` backfills it deterministically, so a *missing* item almost
   always means the spec section was written in a shape the extractor does not
   recognise — go back to the spec (Phase 5 Step 8b), not to the PRD.

   Checks:
   - **a. Every spec exclusion present.** Each bullet in the spec's `## Out of Scope`
     must appear in `prd.outOfScope` (the planner may expand the wording — "no Ink
     TUI" → "no Ink TUI, deferred to arc 3" — but never drop or merge).
     A missing item is a **blocker** *unless* the spec declares more than 25
     exclusions — the cap truncates past `MAX_OUT_OF_SCOPE_ITEMS`, so grade that a
     **minor** and recommend consolidating.
     **The planner is never the cause.** `applyOutOfScopeFallback` restores dropped
     items on every plan path and orders them ahead of the planner's own, so a
     genuine miss means *extraction* failed: an unrecognised heading shape, or a
     declaration sitting after the `## Stories` boundary (story-scoped by design).
     Go back to the spec, not the PRD.
   - **b. Field absent while the spec defers work.** `prd.outOfScope` missing
     entirely is a **blocker only when the spec's section names at least one real
     exclusion.** A section whose entire body is a sentinel (`None`, `N/A`, `TBD`,
     `-`, `Nothing`) is filtered by design and correctly produces no field — not a
     finding. The sentinel list is exact, so `Nothing is deferred.` is *not*
     filtered and becomes an entry shown to every implementer as a hard boundary;
     flag that as a **minor** and ask for a bare `None.`
   - **c. No exclusion became an AC.** An out-of-scope statement that surfaces in
     any story's `acceptanceCriteria` is a **blocker** — the planner inverted "do
     not do this" into work to verify.
   - **d. Story-level echo.** A story whose planner-emitted `**Scope** — Out:`
     description bullets (a PRD convention, not a spec one) or
     `outOfScope` array contradict a feature-level exclusion (claiming the deferred
     work is in scope) is a **blocker**. A story that simply does not echo a
     feature-level item is **not a finding** — `nax plan` propagates the list onto
     every story at load time, so the implementer sees it either way. Note the root
     field is the on-disk SSOT: `savePRD` strips the mirrored copies, so an empty
     `story.outOfScope` in `prd.json` is expected and is *not* evidence that
     propagation failed.
     Conversely, a **per-story** deferral from the spec (a `**Out of scope:**` block
     under a story's AC block) that reaches `prd.outOfScope` is judged **by whether
     it carries a `US-00N only:` prefix** — hoisting itself is legitimate and the
     spec-writing guide asks for it, because only the feature-level list is
     backfilled deterministically:
     - **Prefixed** (`- US-005 only: gap-through fill realism …`) — **not a
       finding.** A deliberate, readable story-scoped boundary. `nax plan` copies
       it onto every story, and the prefix tells the other stories' implementers
       and the adversarial reviewer which story it governs.
     - **Unprefixed** — a **major**. Propagation imposes one story's waiver on
       every story, and the adversarial reviewer can cite it to close a legitimate
       finding in a story the waiver was never meant to cover. Recommend adding the
       prefix, not deleting the bullet.

     Judge the prefix, not the hoist. Flagging every hoisted deferral contradicts
     the authoring guide and produces a false positive on correctly-written specs
     (real case: a spec with three correctly-prefixed `US-005 only:` /
     `US-006 only:` bullets, which its reviewer had to accept by judgment).
   - **e. Orphan exclusions.** Entries in `prd.outOfScope` with no spec source are a
     **minor** (usually the planner making an implicit boundary explicit), unless
     one excludes something the spec's ACs actually require — then a **blocker**.

7. **Sub-slice cleanup story.** If the spec has a terminal-cleanup story, the
   PRD's last story must be deletion-only (no additive ACs), and its removals must
   carry the build/static-gate verification note — not be re-encoded as
   file-content "does not contain" ACs.
8. **`Modifies` → `modifiedFiles`, counted by path.** Every path the spec's
   `### Modifies` block declares must appear as its **own** entry in the owning
   story's `modifiedFiles`, each with `path` and `reason` populated. Compare
   **path counts, not bullet counts** — the extractor yields one entry per bullet,
   taking the leading backticked span as `path` and folding the remainder into
   `reason`, so a spec bullet listing several comma-separated paths silently
   authorises only its first. Two tells, both cheap:
   - an entry whose `reason` **begins with a comma** (or otherwise opens
     mid-sentence) — the separator strip is anchored, so a swallowed second path
     leaves the comma behind;
   - a `modifiedFiles` total lower than the number of distinct paths in the spec
     block.

   **Major**, not blocker: the stray paths still reach the implementer as prose
   inside a neighbouring reason, and authorisation is prompt-rendered rather than
   hard-gated — but the affected files carry no authorisation line of their own,
   which is precisely the deadlock the block exists to prevent. Remediation is in
   the **spec** (one bullet per file, shared reason repeated); the PRD's
   `modifiedFiles` may be patched in place to match, since it is a structural
   field the planner does not author — verify nothing outside `modifiedFiles`
   changed before accepting such a patch.

**Blocker:** spec AC missing from PRD; behavioural AC degraded into a
file-content/grep AC or stripped of its asserted behaviour; meta-AC deleted;
orphan PRD AC introducing material scope; terminal-cleanup story missing or
contaminated with additive ACs; a self-`Creates` file placed in `contextFiles`
instead of `expectedFiles`; a spec out-of-scope statement missing from
`prd.outOfScope`, inverted into an acceptance criterion, or contradicted by a
story's own scope declaration.

**Major:** an upstream-dependency-produced file the spec listed under a consumer
story's `Context Files` that the PRD dropped from `contextFiles` or mis-moved into
the consumer's `expectedFiles` (the read hint was lost or corrupted; the run still
proceeds because the file exists at runtime, so it is a major, not a blocker —
see §4c); a story-scoped deferral hoisted into `prd.outOfScope` **without** a
`US-00N only:` prefix (see §6d); a spec `### Modifies` path that reached no
`modifiedFiles` entry of its own because its bullet declared several paths
(see §8).

**Not a finding:** an upstream-produced file correctly **kept** in the consumer
story's `contextFiles` (it exists at that story's runtime because the producer ran
first). A self-created file absent from `contextFiles` because it is correctly in
the same story's `expectedFiles` is also not a finding. A story-scoped deferral
hoisted into `prd.outOfScope` **with** a `US-00N only:` prefix is not a finding
either — that is the shape the spec-writing guide asks for.

**Output:** writes `prd-fidelity-report.md` in the same directory as `prd.json`
(e.g. `.nax/features/<feature>/prd-fidelity-report.md` for nax projects),
listing each spec AC, its PRD destination (or absence), and any behavioural drift.
This artefact is the gate that should run **after** the planner step and
**before** the first story executes.
