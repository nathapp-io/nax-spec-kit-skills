# SPEC: Config Schema Validation

> A complete, guide-conformant worked example. It is intentionally small but
> exercises every rule the spec-writing guide teaches: the 5 required sections,
> an Integration block, hard sizing bounds, Context Files per story, a dependency
> chain, behavioural `[unit]`/`[integration]` ACs, a **seam AC**, and a
> **terminal-cleanup story** whose removal is verified by the build/static gate
> (not by an AC). It is language-neutral in intent; the example identifiers happen
> to be TypeScript.

## Summary

Add a schema-based config validator that rejects malformed configuration at load
time with actionable errors, and retire the legacy ad-hoc `checkConfig()` helper
it replaces.

## Motivation

Today `loadConfig()` returns whatever JSON it parsed, and the only guard is
`checkConfig()`, which silently coerces bad values (a string `port` becomes
`NaN` downstream). Failures surface deep in unrelated subsystems instead of at
the boundary. We want one validation point that fails fast with a clear message
naming the offending field.

## Design

A pure `ConfigValidator.validate(config)` returns a discriminated result; the
loader calls it and throws on failure. No partial/“best effort” config escapes
the loader.

```ts
export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export class ConfigValidator {
  validate(config: unknown): ValidationResult;
}
```

### Integration

- Wire `ConfigValidator.validate` into `loadConfig()` in `src/config/loader.ts`
  (same place `checkConfig()` is called today).
- On `valid: false`, throw `ConfigError` with the joined `errors`.
- Follow the existing `ConfigError` shape in `src/config/errors.ts`.

## Stories

1. **US-001: Validator core** — add `ConfigValidator` + `ValidationResult`. No dependencies.
2. **US-002: Loader integration** — call the validator from `loadConfig()`. Depends on US-001.
3. **US-003: Retire `checkConfig()`** — terminal-cleanup, deletion-only. Depends on US-002.

### Context Files / Creates

> `Context Files` = existing files to **read** (must exist → `contextFiles`).
> `Creates` = new files the story **authors** (do not exist yet → `expectedFiles`).
> A single path belongs to exactly one list.

**US-001** (greenfield — only creates)
- Creates:
  - `src/config/types.ts` — where `ValidationResult` is declared
  - `src/config/validator.ts` — core validator

**US-002**
- Context Files:
  - `src/config/loader.ts` — `loadConfig()`; replace the `checkConfig()` call site
  - `src/config/errors.ts` — existing `ConfigError` shape to follow

**US-003**
- Context Files:
  - `src/config/legacy-check.ts` — `checkConfig()` to delete
  - `src/config/loader.ts` — remove the last reference once US-002 lands

### Seams

- [integration] stub `ConfigValidator.validate`; call `loadConfig()` on a valid
  file; assert `validate` was called exactly once with the parsed config object.
  (Proves the loader is wired to the validator — not just that the validator exists.)

## Acceptance Criteria

### US-001: Validator core
- [unit] `validate()` returns `{ valid: true, errors: [] }` for a config object
  with all required fields present (`port: number`, `host: string`).
- [unit] `validate()` returns `valid: false` with an error string naming `port`
  when `port` is absent.
- [unit] `validate()` returns `valid: false` with an error naming `port` when
  `port` is a string instead of a number.

### US-002: Loader integration
- [integration] `loadConfig()` throws `ConfigError` when the file's config is
  missing `port`, and the thrown message contains `port`.
- [integration] **(seam)** stub `ConfigValidator.validate`; call `loadConfig()`
  on a valid file; assert `validate` was invoked once with the parsed config.
- [unit] `loadConfig()` returns the parsed config object unchanged when
  validation passes.

### US-003: Retire `checkConfig()` (terminal-cleanup, deletion-only)
**Verification note:** removal verified by `bun run typecheck && bun run lint` —
the compiler rejects any remaining references to the deleted `checkConfig`.

- [integration] config validation previously provided by `checkConfig()` is now
  exercised through `loadConfig()`: loading a file missing `port` throws
  `ConfigError` (capability preserved after the removal).

<!--
Note what this example deliberately does NOT contain:
- No `[verbatim]` / `[grep]` / `[file]` ACs.
- No "file X contains Y" / "grep returns 0" assertions.
- The removal in US-003 is a verification note + a behavioural capability-preserved
  AC, never a "no file contains checkConfig" AC.
-->
