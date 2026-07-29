# Phase 8 — Seam & Deletion Audit

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
   - **Seam-path reality.** Altitude checks that the AC names the *right* entry
     point; this checks that the entry point actually **reaches** the stubbed
     symbol. Classify every seam AC by checking **both** of its endpoints — the
     stubbed symbol *and* the named entry point — against **Phase 1's
     forward-reference allowlist**:
     - **Class A — the path is being *created*.** **Either** endpoint is
       forward-referenced (the spec creates it). There is nothing in current code
       to verify against and the spec is the source of truth. No further work;
       altitude and re-trigger rules apply as above. This deliberately covers the
       common "new route / command wires up an existing service" shape: the
       stubbed symbol is old but the entry point is new, so the path *cannot*
       exist yet and its absence is not a defect.
     - **Class B — the path is *asserted* over existing code.** **Neither**
       endpoint is forward-referenced — both already exist, so the claimed
       connection is checkable and therefore must be checked. Open the entry
       point and walk it to the callee, reporting the observed chain:

       ```
       entry (file:line) → … → callee (file:line)
       ```

       Report the chain you actually observe rather than a yes/no; if you cannot
       complete it, say where it stops. Three **blocker** conditions:

       | condition | why it ships broken |
       |:---|:---|
       | No path exists from the named entry point to the stubbed symbol | the acceptance test can never go green |
       | A path exists only behind an enabling flag / config guard that **nothing in the spec establishes** | the test's default fixture takes the short-circuit branch |
       | The path reaches the symbol but not the **method** the AC names | there is no such call to assert |

       On the guard condition, check the **whole spec before flagging**, not the
       AC in isolation. The guard is satisfied if the AC's own fixture sets it,
       **or** a sibling AC / the spec's design makes it production config the
       story creates. Only flag when *nothing* turns it on. Real near-miss: an AC
       asserting `POST /oauth/token` invokes the idempotency store's
       `putIfAbsent` reads as gated — the interceptor short-circuits unless
       `idempotency.enabled === true` — but a sibling AC in the same story
       declared that option true as production config, so the path was sound.
       Flagging it would have been a false positive on a correct spec.

       Rationale: this class is invisible to every other phase. Phase 1 confirms
       both symbols exist, Phase 2 confirms their shapes, Phase 4 scans *prose*
       for behavioral claims (its patterns are prose-shaped and do not cover an
       AC asserting an invocation), and altitude confirms the entry point is the
       outermost one — the false claim lives on the **edge between the two
       endpoints**, which nothing else inspects. The hole exists because the
       two-anchor rule was designed for new symbols, where the path is being
       created; seam ACs over pre-existing paths inherited no reality check.
       Real cases: an AC asserting `createFlow` invokes the progress lock when
       only `initializeProgress` / `completeStep` / `skipStep` take it; an AC
       asserting a store's *read* is invoked on `POST /oauth/token` when the
       interceptor both short-circuits unless `idempotency.enabled === true` and
       reserves via `putIfAbsent`, so no read call exists. Both shipped through a
       clean phases-1–8 review.
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
6. **Data-availability seam (every input a derivation needs ↔ what the site can
   reach).** For every AC — and every `Interface` formula an AC rests on — that
   *derives a value* at a named code site (renders, charts, plots, aggregates,
   counts, filters, ratios, threshold-gated totals), enumerate **every input the
   derivation needs** and trace each one to a source that is **in scope at that
   site**. A source qualifies only if it is a declared field of a contract the
   site holds, a parameter the site receives, or something the spec explicitly
   routes there. The producer may be **another story's contract, a contract new
   in this same spec, or existing code** — all three are in scope for this check.

   Two distinct failure shapes, both blockers:

   - **Missing output field** — the derivation names a datum the producer never
     emits. A **distribution / histogram** chart over a contract exposing only
     summary percentiles (no samples, bins, or raw series); a **time-series /
     bands / equity-curve** chart over per-bucket scalar summaries (no per-step
     series); any derived field (`producer.foo`) absent from the producer's
     declared shape.
   - **Unsourced input** — the derivation needs a *parameter, threshold, config
     value, or flag* that the site cannot reach. The tell is an **identifier used
     in a formula with no stated provenance**: every other symbol in the sentence
     carries a `file:line`, and this one is bare. Ask of each such identifier:
     *what supplies it, at this site?* If the spec does not answer, that is the
     blocker — the implementer will invent a source, and the invented one usually
     does not exist. The commonest shape: an AC says a value is computed *"at the
     configured `X`"* while the configured `X` is carried on the producer's
     **input** type and never on its **output**, so the site that must emit the
     derived value cannot see it. The implementer reads `X` off the output object,
     the field is absent, the read silently yields the language's empty value, and
     every result is computed against a default instead of the configured setting
     — a wrong answer that still type-checks and still passes the AC's own test.

   **This does not duplicate Phase 2.** Phase 2 falsifies claims the spec *makes*
   ("X has field Y") against existing source. This check catches inputs the spec
   *omits to source* — an absence, which no claim-checker can see. It is also the
   only phase that reconciles two contracts both forward-referenced in the same
   spec, where Phase 2 has nothing to diff against.

   Resolution is **enrich the producer** (add a story/AC emitting the required
   samples/series, or carry the parameter on the output type), **route the input
   explicitly** (name the context slice / argument that delivers it — the same
   treatment the spec already gives its other unreachable values), or **descope
   the consumer AC** to what exists — naming the real datum ("renders a p5/p50/p95
   percentile strip") instead of a data-rich chart type ("renders the distribution
   histogram"). Rationale: the implementer cannot fabricate a missing input, so
   the AC ships an honest-but-non-conforming result. It then fails one of two ways:
   the story **deadlocks** in semantic/adversarial review, which reads the AC's
   literal noun and keeps re-raising it (the missing-output-field mode); or — worse
   — it **passes with a silently wrong value**, because a computed scalar looks
   well-formed and reviewers flag it, if at all, only as a low-severity advisory
   (the unsourced-input mode). Note the trap common to both: such an AC often
   passes its own `[unit]` test — a `data-testid` element is present, a count is a
   number of the right type — while being substantively wrong.

   **Scope bound — do not flag on:** identifiers that are illustrative pseudocode
   rather than a required input; locals the derivation itself computes; values any
   sibling AC or the spec's design already routes to that site. Flag only when the
   AC genuinely needs the input and *nothing in the spec* says where it comes from.

**Blocker:** missing behavioral seam AC for a new exported symbol; seam AC that
triggers an intermediate helper below the wiring instead of the named outermost
entry point (seam-altitude violation); **Class B seam AC whose named entry point
does not reach the stubbed symbol, reaches it only behind an enabling flag/guard
**nothing in the spec establishes**, or does not reach the specific method the AC
names (seam-path reality)**; a derivation AC that consumes data absent from the
producer contract's declared fields, **or that needs an input with no source in
scope at the site** (data-availability seam);
removal-keyword match without a build/static-gate verification note (or encoded as
a file-content AC); mixed additive+destructive story; sizing breach.
