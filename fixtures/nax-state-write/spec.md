# SPEC: Job Retry Backoff

## Summary

Adds exponential backoff to `runJob()` retries so a failing task no longer hammers the queue.

## Motivation

Retries currently fire immediately; a persistently failing job saturates the worker pool.

## Design

`runJob()` gains a `backoff` option. A failed attempt schedules the next one at double the previous delay, capped at `MAX_RETRY_DELAY_MS = 60_000`.

### Failure Handling

A task that exhausts its retry budget raises `RetryBudgetExhausted` carrying the attempt count.

## Out of Scope

- Persistent retry state across process restarts stays unimplemented; a restart resets the schedule.

## Stories

### US-001: Backoff scheduling

Introduce the doubling schedule inside the existing scheduler.

### Context Files

**US-001**
- `src/runner/run_job.py`

### Modifies

**US-001**
- `test/runner/run_job_test.py` — the fixed-delay assertion pins the old schedule; the replacing invariant is that each delay equals twice its predecessor up to the cap.
- `.nax/rules/retry-policy.md` — the rule still states the fixed delay; the replacing text describes the doubling schedule.

## Acceptance Criteria

### US-001

- [unit] calling `runJob()` on a failing task under `backoff` schedules the second attempt at twice the first attempt's delay.
- [unit] a delay that would exceed `MAX_RETRY_DELAY_MS` is clamped to exactly `MAX_RETRY_DELAY_MS`.
- [unit] a task that exhausts its retry budget raises `RetryBudgetExhausted` with the attempt count.
