# Phase 5 — Sizing & Hygiene

**Goal:** spec respects mechanical limits (AC counts per story), has no too-granular stories, and stays internally clean (no duplicates, no orphans, story names match bodies).

**Blocker:** AC count exceeds project cap.

This phase is mechanical — shell commands with no LLM judgment — except the Step 3 one-capability check at 8+ stories.

## Step 1 — Determine the AC cap

```bash
# Project-specific cap
grep -n "maxAcCount\|maxACPerStory" .nax/config.json src/config/*.ts 2>/dev/null | head -5
```

Use the project's configured cap. If none found, default to **15** (matches the broad consensus from spec-writing guides; nax uses 10 by default but the user-configurable cap is typically 15).

## Step 2 — Count ACs per story

```bash
awk '/^### US-/{if(s){print s": "c" ACs"} s=$0; c=0; next} /^- /{c++} END{if(s) print s": "c" ACs"}' <spec-path>
```

The awk counts bullets, which is a lower bound: spec-writing counts **assertions**, because `nax plan` splits a compound AC into one AC per assertion. For a story near the cap, re-count its compound bullets as assertions.

For each story over the cap (counted as assertions) → **BLOCKER**. There is no lower soft limit: a story within the cap is fine.

## Step 3 — Count stories

```bash
grep -c "^### US-" <spec-path>
```

There is **no story ceiling** (spec-writing guide § Story Sizing): in workflow mode, time and cost per
story are flat, so the count alone is never a finding. Check granularity and cohesion instead:
- **Too granular** — two stories share a module and one has <4 ACs, or one is meaningless without the
  other → **MAJOR** (spec-writing Must-merge), recommend merging (unless the merge breaches a must-split rule).
- **8 or more stories** → check the spec is **one capability**. If it bundles independent fixes or
  capabilities → **MAJOR** (spec-writing Step 0 Multi-subsystem), recommend one feature per capability: the bundle ships under one branch
  review and its residual findings land on a human. A coherent capability → no finding; note
  "8+ stories: expect a higher chance of a draft PR" in the report.
- Do not judge branch size from `### Modifies` + `Creates` counts; they undercount the files a run
  changes by about 2x.

## Step 4 — Duplicate detection

Within each story's AC block, look for ACs whose first 50 characters match another AC in the same story:

```bash
# Pseudo — adapt per spec format
awk '/^### US-/{s=$0; next} /^- /{key=substr($0,1,50); if(seen[s,key]++) print "DUP in "s": "key}' <spec-path>
```

Each duplicate → **MAJOR** (revision artifact — usually a leftover from before a refactor).

## Step 5 — Story name ↔ body alignment

For each story, compare:
- Story title (from `### US-NNN: <title>`)
- Story body (the paragraph after the title that describes the work)
- Story ACs (the `### US-NNN: <title>` section under Acceptance Criteria)

If the title says one thing but the body or ACs do something else, that's drift — **MAJOR**.

Common drift: title still mentions an old feature name after a refactor.

## Step 6 — Dependency DAG validity

Read declarations **per story inside `## Stories`**, stopping at the next H1/H2
heading and skipping fenced examples. Accept `Depends on US-001[, US-002]`,
`No dependencies.`, or `Depends on none.` on the story's declaring line or in
its prose. Match phrases case-insensitively. A numbered bold declaration such as
`1. **US-002: Integration** — depends on US-001` also works.

Statements inside `### Modifies`, `### Seams`, `### Context Files`, or
`### Creates` do not declare dependencies. Neither `Dependencies: US-001.` nor
`Deps: US-001` nor a separate `### Dependencies` summary substitutes for a
story-local declaration. Do not infer independence from missing syntax.

For each story, record the declared dependency set and verify:
- Every story explicitly names dependencies or states none, including a single-story spec.
- All referenced stories exist; no self-dependencies or cycles.
- Every dependency points to a lower-numbered story (IDs follow run order).
- Repeated declarations agree as sets; no story states both none and a nonempty list.
- The declared ordering supports the files and interfaces the story consumes.
- Stories listed as independent actually need none (look for upstream-created files).

Missing machine-readable statement → **MAJOR**. Unknown references,
self-dependencies, cycles, or conflicting declarations → **BLOCKER**. A higher
numeric story ID alone is not a cycle; evaluate the graph for cycles, not ID
ordering. A dependency on a higher-numbered story (US-001 depends on US-002) →
**MAJOR**: `nax plan` keeps the IDs and the run follows the graph, so the run
starts out of numeric order. Fix: renumber the stories in dependency order and
update every reference that moves.
Phase 9 compares the explicit sets with the planned `dependencies` arrays.

## Step 6b — Issue closure declarations

Read plain `Closes:` lines outside fenced blocks (case-insensitive, leading
whitespace accepted). Split the remainder on commas/whitespace: each closing
reference must be exactly `#` plus digits. A line can partially extract: in
`Closes: #51, #49.` only `#51` is read. `Fixes:`, prose, bullets, bare numbers,
cross-repo references, and fenced examples are not declarations. The authoring
guide places one optional line immediately below the title.

- Invalid or empty `Closes:` declaration → **MAJOR**; name each ignored token.
- Summary or other feature prose explicitly claims to close, fix, or resolve a
  same-repo `#N`, but the extracted closure set omits it → **MAJOR**. A `Fixes:`
  line or a bullet claiming closure also needs the canonical declaration.
- An issue in the closure set has required resolution work explicitly deferred
  by Out of Scope → **MAJOR**. Resolve the scope conflict before handoff; do not
  silently broaden scope or claim closure.

Ordinary references ("related to #51"), partial work ("partly addresses #51"),
quoted examples, negated closure claims ("does not resolve #51"), and specs with
no issues to close are **not findings**. Judge closure intent in a read-pass;
a grep for `#N` alone cannot establish it. Deferring an optional follow-up for
an otherwise fully resolved issue does not itself contradict closure.

## Step 7 — Context Files completeness

Per spec-writing.md, every story MUST list Context Files. Verify:
- Every `### US-NNN` story has a corresponding entry under the Context Files section
- Each context-files block has at least one entry
- Paths in context blocks are real (cross-check with Phase 1 results)

Missing context block → **MAJOR**.

## Step 7b — No story writes under `.nax/`

`.nax/` is read-only to the implementing agent; only `.nax/scratchpad/` is
writable (spec-writing guide § Paths under `.nax/` are read-only to the run).
nax refuses agent writes to its config and PRDs outright; nax#2260 proposes
extending that to the whole tree. A story that must write there either fails on the
refused write or passes review with the change silently skipped.

Mechanical pass over the `### Creates` and `### Modifies` sections: flag every
bullet whose leading backticked path starts with `.nax/` and not
`.nax/scratchpad/`.

```bash
awk '/^#{1,4} /{w = ($0 ~ /^#{2,4} *(Creates|Modifies)/)} w && /^[[:space:]]*([-*+]|[0-9]+\.)[[:space:]]*`(\.\/)?\.nax\// && !/^[[:space:]]*([-*+]|[0-9]+\.)[[:space:]]*`(\.\/)?\.nax\/scratchpad\//' <spec-path>
```

Then a read-pass over AC bullets and story prose for an outcome that is a `.nax/`
edit ("removes the obsolete rule from `.nax/rules/`", "updates
`.nax/context.md`"). Not findings:

- `Context Files` entries under `.nax/` — reads are allowed.
- A spec for code whose *product behaviour* writes `.nax/` paths, tested in a
  temporary directory — the agent writes the code, not the repo's own `.nax/`.
- A `.nax/` directory nested under another path, such as a test-fixture project
  (`test/fixtures/<project>/.nax/config.json`). It is ordinary content, which is
  why the mechanical pass matches only a leading `.nax/`. A monorepo package's own
  `.nax/` is judged in the read-pass.
- A `.nax/` change recorded as a manual step in `## Out of Scope`, or one covered
  by a write opt-in the spec cites from the project's nax configuration.

Each hit → **BLOCKER** (the story cannot complete as written). Fix: move the
change out of the run as a manual `## Out of Scope` step, or cite the opt-in.

## Step 8 — Required sections present

Per spec-writing.md, every spec must have:
- Summary
- Motivation
- Design
- Out of Scope
- Stories
- Acceptance Criteria

Any missing section → **MAJOR** with the recommendation to add it.

For CLI-tool specs, additionally verify Design includes:
- Exit codes
- stdout vs stderr behavior
- Output format (JSON/YAML/exact example)

For schema-introducing specs, additionally verify Design includes:
- A complete example with every supported field

## Step 8b — `## Out of Scope` is machine-extractable

`nax plan` parses this section deterministically into the PRD's top-level
`outOfScope` array and copies it onto every story — the only channel by which a
deferred arc reaches an implementer that never sees the spec. A section written
in a shape the parser does not recognise is silently dropped, and nothing
downstream will notice.

```bash
# Is the section title one the parser recognises? (emphasis / trailing colon tolerated)
grep -nEi '^#{1,6} *[*`]* *(out[ -]?of[ -]?scope|non[ -]?goals?|not in scope)' <spec-path>

# Setext form — a bare title underlined with === or ---
grep -nEiA1 '^ *(out[ -]?of[ -]?scope|non[ -]?goals?|not in scope) *:? *$' <spec-path>

# Feature-level inline markers must appear BEFORE the story sections
awk '/^#{1,3} *(Stories|Acceptance Criteria)/{print NR": STORY BOUNDARY"; exit} /\*\*Out of scope/{print NR": "$0}' <spec-path>
```

Flag, per finding:

| Condition | Severity |
|:---|:---|
| No recognised section **and** no inline `**Out of scope …:**` lead-in before the story sections, while the spec's prose clearly defers work ("deferred to a later arc", "a later phase will…") | **MAJOR** — the deferral never reaches the implementer |
| Section present but written as one prose paragraph packing several exclusions | **MAJOR** — collapses to a single unreadable entry; split into one bullet each |
| A bullet that is not self-contained ("the above", "this", "it") | **MAJOR** — the implementer reads the bullet with no spec context |
| A **feature-wide** exclusion written only as a `**Out of scope:**` lead-in *after* the first `## Stories` / `## Acceptance Criteria` heading | **MAJOR** — the parser treats post-boundary lead-ins as story-scoped, so it never becomes feature-level. Move it to a `## Out of Scope` section |
| More than 25 bullets | **MINOR** — the parser truncates, and the feature is probably too large |
| An exclusion phrased as an acceptance criterion ("the system does not expose X" under Acceptance Criteria) | **MAJOR** — it is work NOT to do; move it to `## Out of Scope` |

**Not findings** — the parser handles these safely: fenced code blocks inside the
section, `-`/`*`/`+`/`1.`/`•` bullet markers, markdown tables (one item per data row),
a `None.`/`N/A` placeholder, a trailing-colon lead-in above a list, and CRLF endings.

**Scope boundary.** A declaration is feature-level only when it is a top-level
`## Out of Scope` section (anywhere), or an inline `**Out of scope …:**` lead-in
*before* the first `## Stories` / `## Acceptance Criteria` heading. A per-story
`**Out of scope:**` block under a story's AC block is story-scoped by design — do
**not** flag it as a missing feature-level declaration; Phase 4's adversarial-scope
check is what reads it.

## Step 8c — Unrouted constraints

Sweep the Design and Summary sections for normative constraints that name **no
code symbol** — version floors ("requires runtime ≥ X"), dependency bans ("do not
add a new dependency"), naming/copy rules, "no schema migration". Feature-scoped
and repo-wide constraints alike. For each, require one of the four routes from
the spec-writing guide's § Constraint routing: a `## Out of Scope` bullet, a
covering AC, a `### Modifies` entry, or a rule-store home **the spec points at**
(a Design pointer naming the rule file — without it the route is unverifiable
from the spec and counts as unrouted). A constraint with none is visible only as
Design prose, which reaches the implementer solely through planner paraphrase —
the same loss mode as an unextracted deferral (Step 8b), one row over.

Flag **MAJOR** per unrouted constraint. Report once: a prohibition already
flagged by Step 8b's "deferral stated only in prose" row is Step 8b's finding —
do not re-report it here. Boundary: a mandate naming a specific API or call
sequence belongs to Phase 4's P4.7 (unpinned design mandate), not here — this
step covers exactly the constraints P4.7 never reaches.

## Step 9 — AC quality spot-check (mechanical heuristics)

Flag the following AC patterns as **MINOR** (these are smells, not always wrong):

- ACs containing " and " (often two assertions, should split)
- ACs containing "correctly" / "properly" / "appropriately" (vague verbs) — a vague verb already reported by Step 9b (`handle … appropriately/properly`, `as appropriate`) is reported once, at Step 9b's MAJOR; do not re-report it here
- ACs containing "tests pass" / "test file exists" (meta-criteria, not behavior)
- ACs containing "compiles" / "no type errors" (quality gates, run automatically)
- ACs containing "is valid" without specifying what makes it valid

## Step 9b — Placeholder sentinels in channel-reaching text

Four surfaces of the spec are carried into the implementer prompt verbatim or
near-verbatim: Stories/Design prose (synthesised into the story's `description`),
AC bullets (`acceptanceCriteria`), `## Out of Scope` bullets (verbatim-backfilled),
and `### Modifies` reasons (copied verbatim). A placeholder in any of them ships
as an instruction — and as an ungroundable quote surface for reviewers. These are
legal markdown and extract cleanly, so `nax spec lint` never flags them.

```bash
grep -nEi 'TBD|TODO|FIXME|\?\?\?|as appropriate|handle [a-z ]*(appropriately|properly)|similar to US-0|same as US-0|add (validation|error handling)([^a-z]|$)' <spec-path>
```

The trailing-`etc.` sentinel is **not** in the grep — a line grep cannot scope it
to AC bullets, and `etc.` is legitimate in ordinary prose. Check it as a read-pass
over AC bullets only.

For each hit, check it sits in one of the four surfaces (a hit inside a fenced
example block or the Motivation section is not a finding). Flag **MAJOR** per hit,
**except** where the surrounding sentence already names the input, the error type,
and the observable behaviour — the `add validation` / `add error handling`
sentinels target unpinned negative space, not the verb — and **except** a bare
`TBD`/`None.`/`N/A` as the *entire* `## Out of Scope` body, which the extractor
filters as "nothing deferred" (Step 8b's safe list; prefer `None.` per the guide):

| Sentinel | Why it blocks downstream |
|:---|:---|
| `TBD` / `TODO` / `FIXME` / `???` | ships to the implementer as literal instruction text (bare whole-body Out-of-Scope sentinel exempt, per above) |
| `handle … appropriately/properly`, `as appropriate` | the reviewer and implementer each invent a different "appropriate" |
| trailing `etc.` inside an AC (read-pass, not grep) | an et-cetera cannot be tested; enumerate or defer to Out-of-scope |
| `similar to US-00N` / `same as US-00N` | stories execute in isolated sessions — the reader may never see US-00N |
| `add validation` / `add error handling` with no named input, error type, or behaviour | unpinned negative space both reviewers arbitrate in contradictory directions |

Worked example (invented). A `### Modifies` bullet reads `` `test/report/render.test.py` — update affected tests as appropriate ``. The path extracts fine, lint passes, and the implementer prompt now carries an authorisation whose scope is "as appropriate" — the reviewer holds it to one reading, the implementer to another. The fix names the assertion and its replacement invariant, per the Modifies contract.

## Finding template

```markdown
### Blocker — US-NNN has <N> ACs (cap: <cap>)

**Spec reference:** Acceptance Criteria section, US-NNN block

**Issue:** AC count exceeds project cap (<cap>).

**Suggested consolidations:**
- Merge ACs <X>, <Y>, <Z> — same shape, parameterize by input
- Merge ACs <A>, <B> — same outcome, different fixtures
- Drop AC <Q> — duplicate of AC <R>

**Recommended target:** <cap - 2> ACs (leaves buffer for future additions).
```

## Common Phase 5 catches

- AC count over cap (US-003 at 27 ACs in real review)
- Stale duplicate AC from a `complete` → `run` refactor (`build returns { prompt }` left over)
- Story dependencies forming an implicit cycle through context-file references
- Missing Context Files section for a late-added story
- A `### Modifies` entry for `.nax/rules/<file>.md` so the story "keeps the rule in sync" — nax state is read-only to the run; the rule edit is a manual Out-of-Scope step
- ACs containing meta-criteria ("tests pass") that should be removed
- Vague-verb ACs ("handles correctly")
- A deferral stated only in Design prose, with no `## Out of Scope` section — `nax plan` extracts nothing, and the implementer is free to build the deferred arc
