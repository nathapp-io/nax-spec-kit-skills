# SPEC: Per-Tenant Rate Limiting (monorepo variant)

> A short companion to [SPEC-example.md](SPEC-example.md) that exercises the
> **monorepo `Workdir`** rule. The repo here is a workspace monorepo with members
> `packages/core`, `apps/api`, and `apps/web`. Every story declares a
> single-valued `Workdir`; a feature that would span two packages is split into
> one story per package; a root-only change takes `Workdir: .`.

## Summary

Add per-tenant request rate limiting: a shared limiter in `packages/core`, its
enforcement in the `apps/api` request pipeline, a quota indicator in `apps/web`,
and a root workspace config entry that sets the default window.

## Motivation

A single noisy tenant can exhaust API capacity for everyone. We want one limiter
implementation shared across packages, enforced at the API boundary, surfaced to
users in the web client, with a default window configured once at the workspace
root.

## Design

A pure `RateLimiter.check(tenantId)` returns a discriminated result; the API
pipeline calls it and rejects over-limit requests; the web client reads the
remaining-quota header and renders an indicator.

```ts
export interface RateDecision {
  readonly allowed: boolean;
  readonly remaining: number;
}

export class RateLimiter {
  check(tenantId: string): RateDecision;
}
```

### Integration

- `apps/api`: wire `RateLimiter.check` into `requestPipeline()` in
  `apps/api/src/pipeline.ts` (same slot as the existing auth guard).
- `apps/web`: read the `X-RateLimit-Remaining` header in
  `apps/web/src/lib/apiClient.ts`.

## Stories

> Each story carries a single-valued `Workdir`. US-002/US-003 would together
> touch two packages, so they are split per package (Must-split rule). US-004
> changes only the workspace-root config, so its `Workdir` is `.`.

1. **US-001: Limiter core** — `Workdir: packages/core` — no dependencies.
2. **US-002: API enforcement** — `Workdir: apps/api` — depends on US-001.
3. **US-003: Web quota indicator** — `Workdir: apps/web` — depends on US-002.
4. **US-004: Default window in workspace config** — `Workdir: .` — no dependencies.

### Context Files / Creates

> `Context Files` = existing files to **read**. `Creates` = new files the story
> **authors**. A single path belongs to exactly one list.

**US-001** (`Workdir: packages/core`, greenfield — only creates)
- Creates:
  - `packages/core/src/rate-limiter.ts` — `RateLimiter` + `RateDecision`

**US-002** (`Workdir: apps/api`)
- Context Files:
  - `apps/api/src/pipeline.ts` — `requestPipeline()`; insert the limiter check
  - `packages/core/src/rate-limiter.ts` — created by US-001, consumed here

**US-003** (`Workdir: apps/web`)
- Context Files:
  - `apps/web/src/lib/apiClient.ts` — where the response header is read

**US-004** (`Workdir: .`)
- Context Files:
  - `package.json` — root workspace config; add the default-window entry

### Seams

- [integration] stub `RateLimiter.check`; send a request through
  `requestPipeline()`; assert `check` was invoked once with the request's tenant
  id. (Proves the API pipeline is wired to the limiter — not just that it exists.)

## Acceptance Criteria

### US-001: Limiter core (`Workdir: packages/core`)
- [unit] `check()` returns `{ allowed: true, remaining: N-1 }` for the first call
  of a tenant whose window allows `N` requests.
- [unit] `check()` returns `allowed: false` once a tenant's calls within the
  window exceed the configured limit.

### US-002: API enforcement (`Workdir: apps/api`)
- [integration] `requestPipeline()` responds with status `429` when
  `RateLimiter.check` returns `allowed: false` for the request's tenant.
- [integration] **(seam)** stub `RateLimiter.check`; send a request through
  `requestPipeline()`; assert `check` was invoked once with the tenant id.

### US-003: Web quota indicator (`Workdir: apps/web`)
- [unit] `apiClient` exposes `remaining` parsed from the `X-RateLimit-Remaining`
  response header as a number.
- [integration] the quota indicator renders the `remaining` value returned by a
  stubbed `apiClient` response.

### US-004: Default window in workspace config (`Workdir: .`)
- [unit] `RateLimiter` constructed with no explicit window resolves its window to
  the default declared in the workspace-root config.

<!--
Monorepo-specific points this example demonstrates:
- Every story has a single-valued `Workdir` matching a real workspace member.
- A would-be two-package story is split per package (US-002 api / US-003 web),
  not collapsed into one multi-package story.
- A root-only change uses `Workdir: .`.
- A file produced by an upstream story (US-001's rate-limiter.ts) is a legitimate
  read in the consumer's `Context Files`, annotated with its producer.
-->
