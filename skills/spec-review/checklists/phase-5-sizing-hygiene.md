# Phase 5 — Sizing & Hygiene

**Goal:** spec respects mechanical limits (AC counts, story counts) and stays internally clean (no duplicates, no orphans, story names match bodies).

**Blocker:** AC count exceeds project cap.

This phase is fully mechanical — runs as shell commands with no LLM judgment.

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

For each story over the cap → **BLOCKER**.

For each story over the spec-writing.md soft limit (10) → **MINOR**, with a recommendation to consolidate.

## Step 3 — Count stories

```bash
grep -c "^### US-" <spec-path>
```

Target per spec-writing.md: **3–7 stories**. Outside that range:
- **<3 stories** → minor (rare, usually fine)
- **>7 stories** → minor with note: "consider whether stories are too granular; each story should deliver a user-visible capability, not a single function"
- **>10 stories** → major

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

Extract the Dependencies section:
```bash
sed -n '/### Dependencies/,/^### \|^## /p' <spec-path>
```

For each story, parse "depends on" line. Verify:
- All referenced stories exist
- No cycles
- US-NNN ordering matches dependency direction (US-001 should not depend on US-005)
- Stories listed as "no dependencies" actually need none (look for backward references)

Cycles or missing references → **BLOCKER**.

## Step 7 — Context Files completeness

Per spec-writing.md, every story MUST list Context Files. Verify:
- Every `### US-NNN` story has a corresponding entry under the Context Files section
- Each context-files block has at least one entry
- Paths in context blocks are real (cross-check with Phase 1 results)

Missing context block → **MAJOR**.

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
# Is the heading one the parser recognises?
grep -nEi '^#{1,6} *(out[ -]?of[ -]?scope|non[ -]?goals?|not in scope)\b' <spec-path>

# Are the items bullets?
awk 'tolower($0) ~ /^#{1,6} *(out[ -]?of[ -]?scope|non[ -]?goals?|not in scope)/{f=1;next} f && /^#{1,6} /{exit} f' <spec-path>
```

Flag, per finding:

| Condition | Severity |
|:---|:---|
| No recognised heading **and** no inline `**Out of scope …:**` lead-in, while the spec's prose clearly defers work ("deferred to a later arc", "a later phase will…") | **MAJOR** — the deferral never reaches the implementer |
| Section present but written as one prose paragraph packing several exclusions | **MAJOR** — collapses to a single unreadable entry; split into one bullet each |
| A bullet that is not self-contained ("the above", "this", "it") | **MAJOR** — the implementer reads the bullet with no spec context |
| A fenced code block inside the section | **MINOR** — folded as prose; use inline backticks |
| More than 25 bullets | **MINOR** — the parser truncates, and the feature is probably too large |
| An exclusion phrased as an acceptance criterion ("the system does not expose X" under Acceptance Criteria) | **MAJOR** — it is work NOT to do; move it to `## Out of Scope` |

Recognised inline form (also extracted, anywhere in the spec):
`**Out of scope (deferred):** <statement>`. Prose that merely mentions being out
of scope is **not** extracted.

## Step 9 — AC quality spot-check (mechanical heuristics)

Flag the following AC patterns as **MINOR** (these are smells, not always wrong):

- ACs containing " and " (often two assertions, should split)
- ACs containing "correctly" / "properly" / "appropriately" (vague verbs)
- ACs containing "tests pass" / "test file exists" (meta-criteria, not behavior)
- ACs containing "compiles" / "no type errors" (quality gates, run automatically)
- ACs containing "is valid" without specifying what makes it valid

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
- ACs containing meta-criteria ("tests pass") that should be removed
- Vague-verb ACs ("handles correctly")
- A deferral stated only in Design prose, with no `## Out of Scope` section — `nax plan` extracts nothing, and the implementer is free to build the deferred arc
