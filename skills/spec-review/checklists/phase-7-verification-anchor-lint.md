# Phase 7 — Verification-Anchor Lint

Parse every AC and classify its verification mechanism. Only **runtime** tags
are valid: `[unit]`, `[integration]`, `[cli]`. The `[grep]`, `[file]`, and
`[verbatim]` tags are **deprecated and banned** — they describe file-content
greps, which are not agent-implementable test cases (see below).

Checks:

> **Tags are an authoring-time device — they do not survive `nax plan`.** Measured
> corpus-wide: only **331 of 12547 PRD ACs (2.6%)** retain a `[unit]`/`[integration]`/`[cli]`
> tag; the planner strips ~97% while rewriting. So the tag never reaches the
> implementer, test-writer, or reviewer.
>
> That does **not** make this phase pointless — choosing a tag forces the author to
> name a mechanism, which is what turns "the symbol exists" into a runtime assertion,
> and the phase's real value is items 2–7, which police the AC's *prose*. But it does
> set the priority: **the mechanism must be legible from the AC's wording**, because
> the wording is all that survives. Prefer "calling `foo()` with X returns Y" (the
> mechanism is implied and durable) over prose that leans on the tag to say what kind
> of test it is. When a tag is the only thing distinguishing two readings of an AC,
> rewrite the AC.

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
7. **Locus token present.** Every AC must contain at least one **locus token** —
   a symbol, file basename, route, command, or error name that a reviewer would
   have to quote verbatim. An AC naming none is ungroundable in *both*
   directions: a downstream reviewer cannot cite it precisely, and it cannot
   reject an off-target finding. See the spec-writing guide's "Use concrete
   identifiers" rule for the acQuote mechanism this follows from. Flag **major**,
   not blocker — this is a regression guard rather than a live defect; ACs
   drafted under the concrete-identifier rule already satisfy it.

**Blocker:** missing/invalid mechanism; `[grep]`/`[file]`/`[verbatim]` tag;
file-content or shell AC; unpaired new exported symbol with no behavioral seam
AC; removal/absence encoded as an AC; unbacked meta-AC.
**Major:** AC with no locus token.
