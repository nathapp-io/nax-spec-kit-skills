# Phase 6 — Stale-Reference Sweep

**Goal:** every "already shipped" / "DONE" / "MODIFY (additive)" claim reflects current git state.

**Blocker:** claim that contradicts observable reality.

This phase catches revision artifacts — text left over from earlier versions of the spec that no longer matches the codebase as it has evolved.

## Step 1 — Extract status claims

Scan the spec for these claim patterns:

| Claim pattern | What to verify |
|:---|:---|
| "DONE" / "already shipped" / "already implemented" | Symbol exists; primary call sites exist |
| "MODIFY (additive)" / "modify to add" | Symbol does NOT already have the proposed addition |
| "NEW" / "to be created" | Symbol does NOT exist in codebase (caught by Phase 1 already, but cross-check) |
| "Reuses" / "Builds on" | Referenced base exists and has the claimed capability |
| Issue number `#NNN` | Issue exists in tracker |
| Commit SHA | Commit exists in `git log` |
| "Phase 1 / Phase 2 of X" | Prior phase exists; current spec correctly succeeds it |
| "DONE (UNWIRED)" / "exists but no caller" | Symbol exists AND has zero callers outside its defining file |

## Step 2 — Verify "DONE" claims

For each "DONE" claim:

```bash
# 1. Symbol exists
grep -rn "<symbol>" src/ 2>/dev/null | head -3

# 2. If a function/op, has actual callers (not just self-references)
grep -rn "<symbol>" src/ | grep -v "<defining-file>" | head -5

# 3. If a feature, has been wired to its expected integration point
# (Phase 4 also catches this; cross-reference findings)
```

If the symbol exists but has no callers, the claim is misleading — flag as **MAJOR** with the note "ships in name only".

## Step 3 — Verify "MODIFY (additive)" claims

For each proposed schema/type addition, search for whether the field already exists:

```bash
# Does the proposed-additive field already exist?
grep -n "<field-name>" src/<schema-file>
```

If the field already exists with the proposed shape → spec is stale, the addition is a no-op:
- Severity **MAJOR** — implementer wastes time on the "modification"; the real action is to remove this line item

If the field exists with a DIFFERENT shape → not additive, it's a breaking change:
- Severity **BLOCKER** — spec misrepresents the change as additive

## Step 4 — Verify issue/commit references

```bash
# Issue references (if gh available)
gh issue view <N> 2>/dev/null | head -3

# Commit references
git log <SHA> -1 --oneline 2>/dev/null
```

Missing issue/commit → **MINOR** (citation rot — usually harmless but worth noting).

## Step 5 — Verify "Phase N" continuity

If the spec is "Phase 3 of X" or similar:
1. Find Phase 1, Phase 2 specs (likely `docs/specs/SPEC-X-phase-1.md`, etc.)
2. Verify their "next phase" or "future work" section anticipates this spec's scope
3. Verify this spec's "background" or "prerequisites" claims match what prior phases actually shipped

If Phase 1's "remaining work" doesn't overlap with Phase 2's scope, something has drifted between revisions — **MINOR** unless it changes the implementation surface.

## Step 6 — Verify gap-analysis claims

If the spec quotes a gap-analysis or post-mortem document:
1. Open the cited document
2. Verify the spec's summary of it is accurate
3. Verify the issues called out in the gap analysis are addressed (or explicitly deferred) in this spec

This is the most common stale-reference source: a spec is drafted, then the previous-phase implementation is fixed, but the spec still claims the fix is needed.

## Step 7 — Verify cross-spec links

For each markdown link `[X](Y)` in the spec:
- If `Y` is a relative path to another doc, verify it exists
- If `Y` is to a code file with `#L<N>`, verify the file exists and line `N` is roughly where the claim lives

```bash
# Verify markdown link targets
for link in <extracted-links>; do
  ls -la "$link" 2>/dev/null || echo "MISSING: $link"
done
```

Broken link → **MINOR**.

## Finding template

```markdown
### Major — "MODIFY (additive)" claim is stale; field already exists

**Spec reference:** §"Implementation Surface" line <N>
> <spec quote claiming addition>

**Codebase reality:** [`<file>:<line>`](<file>#L<line>) already contains the field with the proposed shape:
```typescript
<existing code>
```

**Impact:** The "modify" line item is a no-op; implementer wastes time. The next phase / dependent ACs may also be miscalibrated.

**Recommended fix:** Remove the line item from "Implementation Surface"; move any referenced acceptance behavior to the "Already shipped" table.
```

## Common Phase 6 catches

- `verifiedBy`, `intent`, `contextFiles[].factId` proposed as "MODIFY (additive)" but already shipped in `src/prd/schema.ts`
- "Citation discipline" claimed as shipped, but `citations.ts` has zero callers
- "DONE" file path with a typo from a rename (`schemas.ts` when actual location is `schemas-infra.ts`)
- "Phase 2 introduced X" but the prior phase's actual implementation didn't include X
- "See ADR-NNN" link pointing to a deleted/renumbered ADR
- Gap-analysis quote that's been resolved by a subsequent commit; spec still claims the gap exists
