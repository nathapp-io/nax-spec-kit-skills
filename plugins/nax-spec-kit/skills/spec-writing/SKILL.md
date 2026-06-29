---
name: spec-writing
description: Convert brainstorming output into a guide-conformant SPEC-*.md ready for spec-review. Bridges open-ended ideation and structured spec authoring. Invoke when user says "draft the spec", "write SPEC-X.md", "convert this brainstorm into a spec", or `/spec-writing <source>`. Enforces sizing, behavioral (executable) verification anchors, seams, terminal-cleanup isolation. ACs are real runtime test cases — never grep/file-content assertions. Project-agnostic and language-agnostic.
---

# Spec Writing Skill

A six-phase drafting protocol that converts brainstorming output into a `SPEC-*.md` satisfying this skill's spec-writing guide. Sits between `brainstorming` (intent exploration) and `spec-review` (audit) in the spec workflow:

```
brainstorming        → spec-writing             → spec-review        → nax plan
(intent exploration)   (intent → SPEC-*.md)       (codebase audit)     (decompose to PRD)
```

Each phase has a stop-the-line gate — if it produces blockers, the next phase doesn't run until they're resolved. Phase 6 hands the draft to `spec-review`; any spec-review blocker loops back to the owning phase.

## When to Activate

- User says "draft the spec for X", "write SPEC-Y.md", "convert this into a spec"
- User invokes `/spec-writing <source>` explicitly
- After `brainstorming` has produced a stable intent summary and the user signals "ready to write it up"
- When extending existing code and the user wants a guide-conformant spec rather than a free-form design doc

## When NOT to Activate

- User is still exploring intent — run `brainstorming` first; this skill assumes intent is stable
- User wants codebase audit of an existing spec — use `spec-review` instead
- User wants to decompose a stable spec into per-story PRD — use the project's planner (e.g. `nax plan`)
- Spec is for a one-off script with no downstream pipeline (no PRD, no per-story execution) — the guide's structure is overkill; write free-form

## Inputs

- **Required:** brainstorm source — any of:
  - In-conversation context (the user has been discussing intent with you)
  - Path to a markdown file (notes, brainstorm export, draft stub)
  - Pasted summary in the invocation
- **Required:** target spec path — where to write the output (e.g. `docs/specs/SPEC-feature.md`)
- **Optional:** path to host project's rule store(s) if not auto-discoverable — nax-native `.nax/rules/` and/or Claude `.claude/rules/`

## Pre-flight

Before Phase 1:

1. **Verify brainstorm input is present.** If user invokes cold with no brainstorm context, no file, no inline summary: redirect to `brainstorming` and halt.
2. **Discover host conventions.** Load the project's rule store(s) to build forbidden-pattern and required-pattern lists. These feed Phase 5 (AC drafting) and Phase 3 (codebase grounding). Run both `ls .nax/rules/` and `ls .claude/rules/`, then read every `*.md` under each that exists.

   **Precedence — nax rules win.** When a project has both stores, `.nax/rules/` is the canonical, agent-neutral SSOT: per-agent shims (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) are generated one-way *from* it via `nax rules export`, and manual edits to those shims are not read back. `.claude/rules/` is a Claude-specific layer (and a migration *source* for `.nax/rules/`, not a generated output). Apply this order, higher wins on conflict:

   1. `.nax/rules/*.md` — **highest priority** (nax-native canonical store)
   2. `.claude/rules/*.md` — Claude-specific layer; use as a supplement, but a `.nax/rules/` directive overrides a conflicting `.claude/rules/` one.

   nax rule files are path-scoped via frontmatter (`paths`, `appliesTo`, optional `priority`). For spec-level convention extraction, read all of them; when an AC or design block targets a specific package/path, prefer the rules whose `paths`/`appliesTo` match. Missing both stores is non-fatal — note in the report that project rules were not found and fall back to the guide's defaults.

## Workflow

Phase outputs accumulate into the target spec file. At the end of each phase, the skill writes (or overwrites) `<target-path>` with the sections drafted so far plus an HTML comment marking the last completed phase:

```html
<!-- spec-writing: completed-through-phase-<N> -->
```

This enables re-entry: if the user interrupts after Phase 3, the file on disk has the Summary, Motivation, and Design (Integration only) sections plus the phase marker. Re-invoking the skill reads the marker and resumes from the next phase.

### Phase 1 — Brainstorm ingestion

Read the brainstorm source. Extract structured fields:

- **Feature goal** — one sentence: what this does. *(required)*
- **Motivation** — what's broken / missing / requested. *(required)*
- **In-scope** — what this spec will deliver. *(required)*
- **Out-of-scope** — what this spec explicitly defers. *(required)*
- **Design decisions already made** — concrete choices (LLM vs AST, sync vs async, schema shape). *(capture if present)*
- **Constraints** — performance, compatibility, security, deadlines. *(capture if present)*
- **Naming choices** — type names, function names, file paths. *(capture if present — do not prompt the user to commit to names here; they emerge during Design)*
- **Extension vs greenfield** — does this modify existing code, or create new modules? Note: many features are **partial extension** (some new code + some existing-code modification) — capture both touchpoints. *(required)*
- **New package vs in-place (monorepo only)** — if the repo is a workspace monorepo, classify greenfield work as either **new modules inside an existing package** or a **completely new package** (a new workspace member with its own manifest/build). This drives the scaffolding gate below. *(required when the repo is a monorepo)*

Surface what was extracted to the user with a one-line summary per field. If any **required** field is missing or contradictory, ask targeted questions before proceeding. Optional fields stay blank.

#### New-package scaffolding gate (monorepo only)

Triggered when **both** hold:

1. The repo is a **workspace monorepo** — detect via any of: `workspaces` in root `package.json`, `pnpm-workspace.yaml`, a Cargo `[workspace]`, `go.work`, a Nx/Turbo/Lerna config, or an existing `.nax/mono/` directory.
2. This feature introduces a **completely new package** — a new workspace member with its own manifest and build, not just new files inside an existing package.

When triggered, ask the user: *scaffold the new package now, or leave package creation to the implementer?* Per the Dialogue-cadence rule, **batch this into Phase 1's single question prompt** alongside any missing-field questions — don't issue it as a separate round-trip. Do not scaffold silently — package creation is a side-effecting structural change, so it waits for the user's answer; the scaffold *action* below runs only after Phase 1's questions are resolved.

- **User says scaffold:** invoke the **`nax-setup` skill** to scaffold and wire the new package (its skeleton + per-package `.nax/mono/<pkg>/config.json` wired to the package's real build/test/lint/typecheck commands). After it completes, record the new package path and its resolved quality commands — Phase 3 grounds against the scaffolded skeleton, and Phase 5 verification notes cite the wired build/static gate.
  - **If the `nax-setup` skill is not available** (not installed in this environment): tell the user it's missing and offer a **best-effort scaffold** instead — only proceed on explicit user approval. The fallback mirrors a sibling package: create the new workspace member (manifest, `src/`, test dir, register it in the workspace list) following the conventions of an existing package in the monorepo, then add a per-package `.nax/mono/<pkg>/config.json` wired to the package's real build/test/lint/typecheck commands. Note in the spec that scaffolding was best-effort (no `nax-setup` skill) so the user can verify it. If the user declines the fallback, treat as "User declines" below.
- **User declines:** note the package as not-yet-existing. Phase 3 has no precedent to read for it (treat as pure-greenfield), and Phase 5 must phrase the package's build/static-gate notes as "once the package's `<build command>` is wired."

If only one of the two conditions holds (not a monorepo, or new modules inside an existing package), skip this gate entirely.

**Blocker:** required field missing; "extension vs greenfield" classification absent; monorepo new-package scaffolding gate triggered but unresolved (user not asked, or answered "scaffold" but the scaffold — via `nax-setup` or best-effort fallback — has not yet been performed).

**Output (written to file):** Summary section and Motivation section drafted from the required fields. If scaffolding ran, the Design section records the new package path and its wired quality commands (in the Integration block if the feature also extends existing code, otherwise as a standalone Design note).

### Phase 2 — Coverage map

Map the extracted intent onto the guide's required sections (Summary, Motivation, Design, Stories, Acceptance Criteria). For each section, classify:

- **Covered** — brainstorm has the content; draft it directly.
- **Partial** — some content; flag the gap and ask the user.
- **Missing** — no content; ask the user before drafting.

Also detect **conditional sub-sections** from the guide and check each:

- CLI tool? → require exit codes, stdout/stderr split, output format example.
- New file format? → require concrete example with every supported field.
- Extending existing code? → require Integration block (existing types, integration point, patterns to follow).
- Multi-implementation feature (LLM vs AST vs regex)? → require Approach declaration.
- Failure modes? → require fail-open/fail-closed, retry behaviour, error output.

For each missing sub-section the spec requires, ask the user one focused question. Batch the questions in a single prompt to minimise round-trips.

**Blocker:** any required sub-section is `missing` and the user hasn't answered the corresponding question.

**Output (written to file):** Design section scaffolded with required sub-sections (Integration / Approach / CLI Behavior / File Format / Failure Handling as applicable). Content is drafted from brainstorm + user answers; the Integration block is left as a placeholder if the feature touches existing code, to be filled by Phase 3.

### Phase 3 — Codebase grounding (extension touchpoints only)

Runs on the **extension-touching portions** of the feature. Pure-greenfield features skip this phase entirely. Mixed features (part extension, part new code) run Phase 3 against the extension touchpoints only — the new-code portions are not grounded here (they have no existing precedent to read).

For each extension touchpoint:

1. **Read the named integration points.** If the user named types/functions/files in Phase 1, open them. Verify they exist and capture their actual signatures.
2. **Identify existing patterns to mirror.** Find a similar feature already implemented in the codebase (e.g. an existing review plugin if speccing a new review check). Note its file layout, naming, error handling pattern.
3. **Detect novel shapes.** If the brainstorm proposes a code shape with no precedent in the codebase (e.g. a deterministic op in a codebase of LLM-only ops), flag for inclusion of a worked skeleton in Design (per guide's "Implementation Approach" rule).

This is a **light symbol audit** — not the full Phase 1 of spec-review. Its purpose is to ensure the Design's Integration block references real symbols with correct signatures, and that novel shapes for new code are paired with worked skeletons.

**Blocker:** named integration point doesn't exist; novel shape proposed without a worked skeleton planned.

**Output (written to file):** Design § Integration block filled with verified symbols/signatures and pattern citations. Worked skeletons inserted for novel shapes.

### Phase 4 — Story decomposition

Estimate AC count and files touched from the intent + design notes. Apply the guide's **hard sizing bounds**:

> **Reads vs creates (see guide § Context Hints).** Per story, separate the files
> into a `Context Files` list (files the story **reads** → `contextFiles`) and a
> `Creates` list (new files the story **authors** → `expectedFiles`). Never list a
> file **this story** creates under its own `Context Files` — it trips a false
> "Relevant file not found" warning at runtime and loses the create-intent hint.
> **Exception — cross-story produced files:** a file an **upstream dependency**
> story creates may be listed under a consumer story's `Context Files` (annotate
> it, e.g. `` `ProposalCard.tsx` — created by US-002, integrated here ``). It is
> absent at plan time but exists at the consumer's runtime (dependencies run
> first), so it is a legitimate read — not a file this story authors. See
> guide § Context Hints.

**Must split** (lower bound enforcement):
- >15 ACs in one story
- Context Files list >5 (the read list; `Creates` is counted separately)
- Story mixes additive ACs ("add X") and destructive ACs ("delete Y", "rename Z", "consolidate W") — split with destruction in a terminal-cleanup story
- Story has both "add new feature" and "refactor existing code"
- **(monorepo only)** Story touches more than one workspace package — split into one story per package so each story has a single `Workdir`. A repo-root-only story (root config, workspace manifest) is not a split trigger; it takes `Workdir: .` (see Workdir assignment below). This split applies before the Must-merge / hard-ceiling checks: a per-package split is structural and is never merged back into a multi-package story.

**Must merge** (upper bound enforcement):
- More than 7 stories in the spec — over-decomposition is the symmetric failure of over-bundling.
- Merge two stories when **either** condition holds: (a) they share a module and at least one has <4 ACs; or (b) one is meaningless without the other (regardless of module). **Never merge if the result would breach a Must-split rule above** (e.g. >15 ACs combined, additive+destructive mix) — leave them separate.
- **Cost tiebreaker:** if the feature can be expressed in N-1 stories without breaching any Must-split rule, prefer N-1. Story count is driven up by split rules, never by a preference to decompose.
- **Soft target 3-5, hard ceiling 7.** Each story is its own plan/implement/review pass, so count is ~linear in cost. Reserve the 6th/7th story for features that *structurally* need it — a dependency chain, a terminal-cleanup story, or a producer/consumer seam. If a story exists only because the work "felt separable," merge it. Single-story specs are acceptable for tiny features.

Detect **removal keywords** in the intent (`delete|remove|consolidate|retire|rename|migrate`). If any present:

- Plan a **terminal-cleanup story** at the end of the dependency chain.
- The terminal story is **deletion-only**: no new code — file deletions, caller migrations, import removals. Its removals are verified by the host project's build/static gate (compiler, linter, `bun run typecheck`), not by runtime acceptance criteria; record the gate command in the story's verification note.

Detect **producer/consumer seams**. A seam exists when story A introduces a **new externally-visible symbol** — anything added to a barrel/`index.ts`, exported from a module entry point, or otherwise callable from outside its declaring file — and story B is expected to call it. Pure internal helpers (file-local functions, non-exported types) do not need seam ACs.

For each seam:

- Plan a **Seam invariant** declared in B's ACs: a behavioral `[unit]`/`[integration]` AC where B's test stubs/spies the new symbol, triggers B's production path, and asserts the symbol was invoked with the expected arguments (see Phase 5 "Nax-friendly AC format"). This proves the call site exists *and* is wired — never a file-content/grep assertion that the text appears.

#### Workdir assignment (monorepo only)

If the repo is a **workspace monorepo** (detected in Phase 1 — `workspaces` in root `package.json`, `pnpm-workspace.yaml`, Cargo `[workspace]`, `go.work`, Nx/Turbo/Lerna config, or an existing `.nax/mono/` directory), **every story must declare a `Workdir`** — the package directory the story operates in, relative to the repo root.

- The value is a single package path that matches a workspace member (e.g. `apps/api`, `apps/web`, `packages/core`) — ideally one with a wired per-package `.nax/mono/<pkg>/config.json`, so nax runs that package's build/test/lint/typecheck gates in the right directory.
- A story that operates only on repo-root files (root config, the workspace manifest, top-level tooling) takes `Workdir: .`.
- A story must never carry more than one package — the per-package Must-split rule above guarantees a single-valued `Workdir`. If you find yourself wanting two packages in one `Workdir`, split the story.
- For a **new package** scaffolded in Phase 1, the `Workdir` is that new package's path.
- Non-monorepo repos do not use `Workdir` — omit it entirely (do not write `Workdir: .` for a single-package repo).

`nax plan` maps each story's `Workdir` to the `workdir` field in `prd.json`, scoping the implementation session and quality gates to that package.

Propose the story list with dependencies (and per-story `Workdir` when monorepo) to the user. Confirm before proceeding.

**Blocker:** sizing breach not resolved (over or under); removal keywords present with no terminal-cleanup story planned; new externally-visible symbol without a planned seam AC for its consumer story; **monorepo detected and any story is missing a `Workdir`, carries more than one package, or names a package path that is not a workspace member**.

**Output (written to file):** Stories section with 3-7 stories, dependency chain, `Context Files` (reads) and `Creates` (new files) per story, a single-valued `Workdir` per story when the repo is a monorepo, terminal-cleanup story if applicable, and a `### Seams` block listing cross-story invariants.

### Phase 5 — AC drafting

For each story, draft ACs in two tracks:

**Track A — Behavioural ACs.** Per the guide's "Acceptance Criteria Format":

- One AC = one assertion.
- Concrete identifiers (function names, return types, error messages).
- Specifies HOW things connect.
- No quality gates, no meta-ACs about tests passing, no vague verbs.

**Track B — Verification anchoring.** This is not a second list of ACs — it is the rule that every Track A AC must itself *be* the executable anchor (a real runtime test the implementer writes fail-first, then makes pass), plus the extra anchors (seam ACs, gate notes) below. Translate each mechanical claim into the behaviour that proves it:

- **Symbol exists / is usable** → don't assert the source text contains the name; assert you can *use* it. "Importing/referencing `Symbol` from `<module>` succeeds and `Symbol` is usable as a `<class|struct|function|type>`" — a `[unit]` test that imports and exercises it. (Pasting the name into a comment passes a grep; it fails an import-and-use test.)
- **Type / shape** → construct or obtain the value, assert its type/fields/return shape.
- **Config field default** → construct the config with the field unset, assert the resolved value equals the documented default.
- **New exported symbol from Track A** → pair with a **seam AC** (the **two-anchor rule**): the consumer's `[unit]`/`[integration]` test stubs the new symbol, triggers the consumer's production path, and asserts the symbol was invoked with the expected arguments. This proves *used*, not just *present*.
- **Removal / absence** → **not** an acceptance criterion. Deleting a symbol is a compile error in statically-typed languages (Go, Rust, C++, TS) and only a weak runtime check in dynamic ones — neither is a fail-first-then-pass test an agent can implement. Route removal to the host project's **build/static gate** (compiler, linter, `bun run typecheck`) and record the gate command in the story's verification note. (For a dynamic-language project where "accessing the removed member raises the language's missing-member error" is meaningful, a `[unit]` test is *optional*, not required.)
- **Meta-ACs** (architectural invariants like "only N edit points") → if it isn't a runtime behaviour an implementer can test, it's not an AC. Express it as the build/static gate, or drop it.

After drafting:

1. Verify every AC has a runtime verification mechanism tag (`[unit]` / `[integration]` / `[cli]`). The legacy `[grep]`, `[file]`, and `[verbatim]` tags are **banned** — they describe file-content greps, which are not agent-implementable test cases (see "Why" below).
2. Verify every AC is a behaviour an implementer can write as a fail-first test — no "file X contains Y" / "file X matches regex Z" / "file X does not contain Y" assertions.
3. Verify the AC contains **zero shell commands** (no `grep`, `wc`, `find`, `awk`, `sed`, `|`, `$(...)`).
4. Verify the two-anchor rule on every new exported symbol (behavioral seam AC present).
5. Verify removal keywords trace to a build/static-gate verification note, not to an AC.

**Blocker:** untagged AC; AC tagged `[grep]` / `[file]` / `[verbatim]`; AC expressed as a file-content / grep / "file contains" assertion; **any AC containing a shell command** (`grep`, `wc -l`, `find`, `awk`, `sed`, shell pipe `|`) **or a language-specific test API** (`readFileSync`, `expect()`, `assert "X" in ...`, `os.ReadFile`, etc.); unpaired new externally-visible symbol with no behavioral seam AC (as defined in Phase 4); removal keyword encoded as an AC instead of a build/static-gate note; aspirational meta-AC.

#### Nax-friendly AC format (mandatory)

`nax plan` decomposes the spec into `prd.json`, and each `acceptanceCriteria` entry becomes the direct input to a **nax agent implementation session**: the agent writes a failing test, then writes production code to make it pass. So **every AC must be a real runtime test case**, stated in **language-neutral prose** so the generator can emit it in the host project's framework — `bun:test` for TypeScript, `pytest` for Python, `go test` for Go, `cargo test` for Rust, JUnit for Java, etc.

Name the function/symbol, the inputs, and the expected output/exception/side-effect. The generator picks `expect()` / `assert` / `assert.Equal` / `assert_eq!` / `assertEquals`.

| ❌ Forbidden (file-content / grep / shell / language-specific) | ✅ Required (language-neutral runtime behaviour) |
|:---|:---|
| `[file]` `path/file` contains a line matching `^def foo\(` | `[unit]` calling `foo()` with `<inputs>` returns `<expected>` (and `foo` is importable from `<module>`). |
| `[file]` `file` contains the substring `BacktestCancelled` | `[unit]` `BacktestCancelled` is importable from `<module>` and is a subtype of the language's base error type. |
| `[file]` `file` contains field `timeout` with default `30` | `[unit]` constructing `Config` with `timeout` unset yields `config.timeout == 30`. |
| `[file]` no file under `src/` contains `old_symbol` | *(not an AC)* removal verified by build/static gate — note: `<build/lint command, e.g. bun run typecheck>`. |
| `` `grep -nE "PAT" path` returns 1 match `` | `[integration]` stub `<callee>`; trigger `<production path>`; assert `<callee>` called once with `<args>`. |
| `readFileSync(path).includes("X")` / `assert "X" in open(path).read()` | name the runtime behaviour that the presence of `X` is supposed to enable, and assert *that*. |

State the **behaviour**, not the implementation and not the source text. "Symbol is present in the file" is a meta-test about source text: it passes when the name is pasted anywhere — even in a comment — and proves nothing about whether the symbol is importable, correctly typed, or wired into a caller. Assert the behaviour the symbol enables instead.

**Why:** `prd.json` ACs run as agent-implemented tests, not as a static grep gate. A file-content assertion (1) passes as soon as the string appears anywhere in the file, (2) never verifies the symbol is importable/usable/typed, and (3) gives the implementer no signal about what the symbol must *do*. Negative-grep assertions ("no file contains X") can't be expressed as a runtime test at all. Shell pipelines and language-specific assertion APIs additionally break the polyglot generator. Language-neutral behavioural prose is the only form that survives `nax plan` into an executable, meaningful test. Static greps that you still want as a CI gate belong in `bun run typecheck` / a linter, never in `acceptanceCriteria`.

**Output (written to file):** Acceptance Criteria section, per-story AC blocks with verification anchors. At this point the spec file is structurally complete.

### Phase 6 — Self-review handoff

By Phase 6 the target file already contains the complete draft (Phases 1–5 wrote incrementally). This phase performs the final audit by **transitioning to the spec-review skill** — the agent loads spec-review and follows its phases 1-8 against the draft. spec-review is not invoked as a subprocess; it's the next skill the agent runs.

#### Pre-handoff shell sweep (mandatory)

Before invoking spec-review, grep the draft for non-runtime AC tokens. Any hit is a Phase 5 regression that must be fixed in-file before Phase 6 proceeds — do **not** rely on spec-review Phase 7 to catch this; that's a defense-in-depth check, not the primary gate.

Banned tokens (treat each hit as a blocker):

- Deprecated tags: `[grep]`, `[file]`, `[verbatim]` (file-content assertions are not agent-implementable tests).
- File-content phrasing in an AC: `contains the substring`, `contains exactly`, `matches the regex`, `does not contain`, `no file under` — these describe greps, not behaviours.
- `grep -` / `grep "` / `grep '`
- ` wc -l` / ` wc -c`
- ` find ` (as a shell invocation, not the English word)
- ` awk ` / ` sed `
- Shell pipe inside backticks: `` ` ... | ... ` ``
- Command substitution: `$(` inside backticks

For each hit, rewrite the AC into the runtime behaviour it is meant to prove, using the conversion table in §Nax-friendly AC format above (or move a removal/absence claim to the story's build/static-gate verification note). Re-grep until zero hits remain. Then transition to spec-review.

**Rationale:** `nax plan` decomposes spec.md into `prd.json`, whose `acceptanceCriteria` are fed into agent implementation sessions that write a failing test then make it pass — there is no shell executor and no static-grep step. A file-content / shell AC either can't be expressed as a runtime test (negative greps) or degrades into a meaningless meta-test that passes on a pasted string. Catching this at Phase 6 saves a full planner round-trip; spec-review Phase 7/9 are defense-in-depth.

Loop policy:

- **First pass — no blockers:** hand the spec back to the user with a one-line summary. Done.
- **First pass — blockers:** identify which spec-writing phase owns each blocker (Phase 3 owns symbol-existence blockers, Phase 5 owns AC-tagging blockers, etc.). Fix in-file, then re-run spec-review.
- **Second pass — still blockers:** stop. Hand back the partial spec with the remaining blocker list and ask the user to resolve. Two passes is the cap — further loops on a fundamentally broken draft burn budget without converging.

Do **not** invoke spec-review's Phase 9 (PRD fidelity) — there is no PRD yet. That phase runs after the host project's planner step (e.g. `nax plan`).

**Blocker:** spec-review reports unresolved blockers after 2 passes.

**Output (written to file):** Spec file unchanged from Phase 5 if spec-review passed; otherwise updated with whichever blockers were fixed in pass 1. The phase marker is updated to `completed-through-phase-6` only if spec-review passed clean; otherwise it stays at `phase-5` so re-entry knows the audit is unresolved.

## Operational rules

### Guide is source of truth

This skill is the SSOT for spec-writing rules. See [reference/spec-writing-guide.md](reference/spec-writing-guide.md) for the full reference. Every phase enforces the rules defined there.

### Dialogue cadence

Phases 1, 2, 4 routinely require user input. Batch questions per phase — never ask one question, wait, then ask another in the same phase. The user should see one question prompt per phase, with all open questions in that prompt.

### Re-entry

Each phase writes the target file at completion and updates the phase marker comment:

```html
<!-- spec-writing: completed-through-phase-<N> -->
```

If the user re-invokes the skill on a path that already exists:

1. Read the file. Grep for the phase marker.
2. If marker is `completed-through-phase-6` and spec-review passed: the spec is done. Confirm with the user whether to re-run from scratch or treat as a no-op.
3. Otherwise: resume from `<N>+1`. The earlier sections are treated as already-drafted (do not re-prompt for Phase 1 fields the user has already answered).
4. If the file has no phase marker: treat as a hand-edited spec, not a partial skill run. Offer to run spec-review instead, or to restart from Phase 1 with the existing content as a "brainstorm source."

### Greenfield specs

Phase 3 is skipped. Phase 4 may produce simpler decomposition (often 1-2 stories for greenfield CLI tools). Phase 5's two-anchor rule still applies — even for new code, isolated unit tests don't prove the production caller works.

**Monorepo new-package case.** When the greenfield work is a *completely new package* in a workspace monorepo, Phase 1's new-package scaffolding gate fires first: ask the user whether to scaffold, and if yes invoke the `nax-setup` skill to create and wire the package before drafting continues. If scaffolding ran, Phase 3 grounds against the new skeleton (no longer pure-greenfield for that package) and Phase 5 cites the wired per-package build/static gate; if declined, treat the package as pure-greenfield and phrase gate notes as pending package wiring.

### Removal-heavy specs

When the intent is dominated by deletions (consolidation specs, dead-code cleanup), Phase 4 will produce a terminal-cleanup story that's the bulk of the work. Its removals are verified by the host project's build/static gate (the compiler/linter rejects references to deleted symbols; `bun run typecheck` or a lint step confirms absence) — recorded as a verification note on the story, **not** as runtime acceptance criteria. Don't pad with behavioural ACs to make it feel "balanced," and don't invent file-content "does not contain" ACs — those aren't agent-implementable tests.

## Output format

The skill writes a `SPEC-*.md` matching the guide's structure:

```markdown
# SPEC: <Feature Name>

## Summary
<one paragraph from Phase 1>

## Motivation
<from Phase 1>

## Design
<from Phase 2 coverage map + Phase 3 grounding>
### Integration (if extending)
### Approach (if multi-implementation)
### CLI Behavior (if CLI)
### File Format (if new format)
### Failure Handling

## Stories
<from Phase 4 — 3-7 stories with dependencies; each story carries a single-valued `Workdir: <package path>` when the repo is a monorepo>
### Seams
<from Phase 4 — cross-story invariants>

## Acceptance Criteria
<from Phase 5 — per-story ACs with verification anchors>
```

After writing, produce a single-message summary to the user:

```markdown
# Spec Drafted — <spec path>

**Source:** <brainstorm source>
**Phases run:** 6 of 6
**spec-review:** <ready / blockers resolved after N iterations>

## What was drafted
- <N> stories, <M> ACs total (all runtime `[unit]`/`[integration]`/`[cli]`)
- Terminal-cleanup story: <yes/no> (removals verified via build/static gate: <command>)
- Seam ACs declared: <count>
- Monorepo: <yes/no> — when yes, each story scoped to a `Workdir` (<list of distinct package paths>)

## User decisions captured
1. <decision from Phase 1>
2. <decision from Phase 2>
...

## Next step
Run `spec-review --spec <path>` for a full codebase audit before `nax plan`.
```

## What this skill is NOT

- **Not brainstorming.** Assumes intent is stable. If intent is fluid, redirect to `brainstorming`.
- **Not spec-review.** Performs only a light symbol audit in Phase 3 and invokes full spec-review in Phase 6. Doesn't replace spec-review's nine phases.
- **Not `nax plan`.** Decomposes into stories at the spec level (3-7 user-visible capabilities), not into PRD slices (per-AC executable plans).
- **Not a design reviewer.** Doesn't judge whether the design is good — only whether it's structured per the guide. Use `architect` or `code-reviewer` for design quality.
- **Not project-specific.** Rules come from [reference/spec-writing-guide.md](reference/spec-writing-guide.md) and the host project's rule store(s) — `.nax/rules/` (nax-native canonical store, higher priority) and/or `.claude/rules/`. Same skill works on any project.

## Cost & cadence

| Phase | Tool calls | Tokens | Notes |
|:---|:---|:---|:---|
| 1 — Ingest | 1-5 | 2-5k | Read brainstorm source. |
| 2 — Coverage | 0-2 | 3-8k | Mapping + question batching. |
| 3 — Grounding | 10-50 | 5-15k | Variable; greenfield skips this. |
| 4 — Decompose | 0-5 | 5-10k | Mostly LLM drafting. |
| 5 — AC drafting | 0-5 | 10-25k | Largest drafting phase. |
| 6 — Self-review | 50-150 | 20-50k | Runs spec-review 1-2 times. |
| **Total (extension)** | **60-220** | **45-115k** | Typical. |
| **Total (greenfield)** | **20-80** | **30-80k** | Phase 3 skipped, lighter Phase 6. |

Use this skill:

- **Once per spec** during the drafting workflow, after `brainstorming` and before `spec-review`
- **Not iteratively during drafting** — the user should review the output spec, edit it, then re-run `spec-review` standalone for revisions
- **Re-entry is supported** but full re-runs are not the intended cadence

## Spec-Writing Guide

See [reference/spec-writing-guide.md](reference/spec-writing-guide.md).
