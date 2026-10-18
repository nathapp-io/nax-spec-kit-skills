// Tier 1 fixture evaluation — deterministic regression coverage for a subset of
// the MECHANICAL checks the skills document as literal grep/awk procedures.
//
// Each check below mirrors a documented procedure; the doc is the SSOT and this
// file must be updated in the same PR whenever one of those procedures changes:
//   trailing-html-comment    -> spec-writing SKILL.md, marker-placement rule (Workflow)
//                               + guide "## Out of Scope" second trap
//   oos-unrecognised-shape   -> spec-review checklists/phase-5-sizing-hygiene.md Step 8b
//                               (ATX + setext title forms; inline markers count only
//                               BEFORE the story boundary, per the Step 8b awk)
//   placeholder-sentinels    -> spec-review checklists/phase-5-sizing-hygiene.md Step 9b
//                               (+ spec-writing Phase 6 placeholder-sentinel sweep;
//                               documented exemptions: Motivation prose, and a bare
//                               whole-body TBD/None./N/A Out-of-Scope sentinel)
//   banned-verification-tags -> spec-review checklists/phase-7-verification-anchor-lint.md
//   modifies-multipath       -> spec-writing guide "one file per bullet" (Modifies
//                               contract; a bullet's indented continuation lines
//                               belong to the same logical bullet)
//   nax-state-write          -> spec-review checklists/phase-5-sizing-hygiene.md Step 7b
//                               + spec-writing guide "Paths under .nax/ are read-only
//                               to the run" (Creates/Modifies only; Context Files
//                               reads and .nax/scratchpad/ are allowed)
//
//   dependency-missing / dependency-conflict / dependency-forward
//                            -> spec-review Phase 5 Step 6, spec-writing Phase 6
//                               (forward = depends on a higher-numbered story;
//                               guide "Story IDs follow dependency order")
//   closes-invalid           -> spec-review Phase 5 Step 6b (token syntax only)
//   dependency-fidelity      -> spec-review Phase 9 §3b (optional prd.json input)
//
// Contract: every fixtures/<name>/ directory carries spec.md + expected.json
// ({ mustFire: [checkId...] }), and optionally prd.json for Phase 9. A fixture fails when the fired set differs from
// mustFire in EITHER direction — control-clean (mustFire: []) is what guards
// against over-firing. Judgment checks (P4.n, Step 8c, seam tracing) are out of
// scope here: they need an LLM reviewer (Tier 2, not built). Not every
// mechanical check is fixtured yet — see the README's corpus section.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = join(root, "fixtures");

/** Strip fenced code blocks — a hit inside a fence is not a finding. */
function withoutFences(lines) {
  let fenced = false;
  return lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return "";
    }
    return fenced ? "" : line;
  });
}

const OOS_TITLE = /(out[ -]?of[ -]?scope|non[ -]?goals?|not in scope)/i;

function storyBoundaryIndex(lines) {
  const i = lines.findIndex((l) => /^#{1,3} *(Stories|Acceptance Criteria)/i.test(l));
  return i === -1 ? lines.length : i;
}

function hasRecognisedOosHeading(lines) {
  const atx = new RegExp(`^#{1,6} *[*\`]* *${OOS_TITLE.source}`, "i");
  const setextTitle = new RegExp(`^ *[*\`]* *${OOS_TITLE.source} *:? *$`, "i");
  return lines.some(
    (l, i) =>
      atx.test(l) || (setextTitle.test(l) && /^ *[=-]{2,} *$/.test(lines[i + 1] ?? "")),
  );
}

/** Blank out a section (from its heading to the next same-or-higher heading). */
function blankSection(lines, headingRe) {
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start === -1) return lines;
  let end = lines.slice(start + 1).findIndex((l) => /^#{1,2} /.test(l));
  end = end === -1 ? lines.length : start + 1 + end;
  return lines.map((l, i) => (i >= start && i < end ? "" : l));
}

/**
 * Fixture-only reader for the documented canonical declaration forms. This is
 * not a replacement for nax's full grammar or spec-review's semantic DAG pass.
 * Scope matches the guide: Stories only, no fences or grouped file reasons.
 */
function dependencyDeclarations(rawLines) {
  const stories = new Map();
  let inStories = false;
  let grouped = false;
  let current;
  for (const raw of withoutFences(rawLines)) {
    const line = raw.replace(/\*\*|__|`/g, "");
    if (/^##\s+Stories\b/i.test(line)) {
      inStories = true;
      continue;
    }
    if (/^#{1,2}\s/.test(line)) inStories = false;
    if (!inStories) continue;
    if (/^#{1,6}\s/.test(line)) {
      grouped = /^#{1,6}\s*(Modifies|Modified files|Seams|Context Files|Creates)\b/i.test(line);
    }
    const id = (/^#{1,6}\s+(US-\d+)\b/i.exec(line)
      ?? /^\s*(?:(?:\d+\.|[-*])\s+)?\*\*\s*(US-\d+)\b/i.exec(raw))?.[1]?.toUpperCase();
    if (id) {
      if (!stories.has(id)) stories.set(id, []);
      current = stories.get(id);
    }
    if (!current || grouped) continue;
    if (/\bno\s+dependencies\b/i.test(line)) current.push([]);
    for (const mention of line.matchAll(/\bdepends\s+on\b/gi)) {
      const rest = line.slice(mention.index + mention[0].length).replace(/^[\s:*_(]+/, "");
      if (/^none\b/i.test(rest)) current.push([]);
      else {
        const list = /^(US-\d+\b(?:[\s,;&]+(?:and\s+)?US-\d+\b)*)/i.exec(rest)?.[1];
        if (list) current.push([...new Set(list.toUpperCase().match(/US-\d+/g))].sort());
      }
    }
  }
  return stories;
}

function storyNumber(id) {
  return Number(/\d+/.exec(id)[0]);
}

function conflictingDependencies(lists) {
  return new Set(lists.map((list) => JSON.stringify(list))).size > 1;
}

const CHECKS = {
  "dependency-missing": (lines) =>
    [...dependencyDeclarations(lines).values()].some((lists) => lists.length === 0),

  "dependency-conflict": (lines) =>
    [...dependencyDeclarations(lines).values()].some(conflictingDependencies),

  "dependency-forward": (lines) =>
    [...dependencyDeclarations(lines)].some(([id, lists]) =>
      lists.flat().some((dep) => storyNumber(dep) > storyNumber(id)),
    ),

  "closes-invalid": (rawLines) => withoutFences(rawLines).some((line) => {
    const declaration = /^\s*closes:(.*)$/i.exec(line);
    if (!declaration) return false;
    const tokens = declaration[1].split(/[\s,]+/).filter(Boolean);
    return tokens.length === 0 || tokens.some((token) => !/^#\d+$/.test(token));
  }),

  "dependency-fidelity": (lines, prd) => {
    if (prd === undefined) return false;
    return [...dependencyDeclarations(lines)].some(([id, lists]) => {
      // Unstated/conflicting spec intent is a Phase 5 finding, not an empty set.
      if (lists.length === 0 || conflictingDependencies(lists)) return false;
      const story = prd.userStories?.find((s) => s.id?.toUpperCase() === id);
      if (!Array.isArray(story?.dependencies)) return true;
      if (story.dependencies.some((dep) => typeof dep !== "string")) return true;
      const actual = [...new Set(story.dependencies.map((dep) => dep.toUpperCase()))].sort();
      return JSON.stringify(lists[0]) !== JSON.stringify(actual);
    });
  },
  "trailing-html-comment": (rawLines) => {
    const lines = withoutFences(rawLines);
    const firstHeading = lines.findIndex((l) => /^#/.test(l));
    if (firstHeading === -1) return false;
    return lines.slice(firstHeading + 1).some((l) => l.includes("<!--"));
  },

  "oos-unrecognised-shape": (rawLines) => {
    const lines = withoutFences(rawLines);
    const boundary = storyBoundaryIndex(lines);
    const inlineMarkerBeforeStories = lines
      .slice(0, boundary)
      .some((l) => /\*\*Out of scope/i.test(l));
    const defersWork = /deferred to a later|a later (phase|arc) will/i.test(lines.join("\n"));
    return defersWork && !hasRecognisedOosHeading(lines) && !inlineMarkerBeforeStories;
  },

  "placeholder-sentinels": (rawLines) => {
    let lines = withoutFences(rawLines);
    // Documented exemption: Motivation prose quoting existing code is not a finding.
    lines = blankSection(lines, /^## *Motivation\b/i);
    // Documented exemption: a bare whole-body TBD/None./N/A Out-of-Scope section is
    // extractor-filtered ("nothing deferred") — not a hit for the TBD sentinel.
    const oosStart = lines.findIndex((l) =>
      new RegExp(`^#{1,6} *[*\`]* *${OOS_TITLE.source}`, "i").test(l),
    );
    if (oosStart !== -1) {
      let end = lines.slice(oosStart + 1).findIndex((l) => /^#{1,2} /.test(l));
      end = end === -1 ? lines.length : oosStart + 1 + end;
      const body = lines
        .slice(oosStart + 1, end)
        .join(" ")
        .trim();
      if (/^(TBD|None\.?|N\/A)$/i.test(body)) {
        lines = lines.map((l, i) => (i > oosStart && i < end ? "" : l));
      }
    }
    return /TBD|TODO|FIXME|\?\?\?|as appropriate|handle [a-z ]*(appropriately|properly)|similar to US-0|same as US-0|add (validation|error handling)([^a-z]|$)/i.test(
      lines.join("\n"),
    );
  },

  "banned-verification-tags": (rawLines) =>
    withoutFences(rawLines).some((l) =>
      /^\s*(?:[-*+]|\d+\.)\s*\[(grep|file|verbatim)\]/i.test(l),
    ),

  "modifies-multipath": (rawLines) => {
    const clean = withoutFences(rawLines);
    const start = clean.findIndex((l) => /^#{2,4} *Modifies\b/i.test(l));
    if (start === -1) return false;
    let end = clean.slice(start + 1).findIndex((l) => /^#{1,4} /.test(l));
    end = end === -1 ? clean.length : start + 1 + end;
    // Fold indented continuation lines into their bullet — the guide's own wrong
    // example wraps the second path onto the next line.
    const bullets = [];
    for (const l of clean.slice(start + 1, end)) {
      if (/^\s*(?:[-*+]|\d+\.)\s/.test(l)) bullets.push(l);
      else if (/^\s+\S/.test(l) && bullets.length) bullets[bullets.length - 1] += ` ${l.trim()}`;
    }
    return bullets.some((b) => (b.match(/`[^`]+\.[a-z0-9]+`/gi) ?? []).length >= 2);
  },

  "nax-state-write": (rawLines) => {
    const clean = withoutFences(rawLines);
    let inWriteList = false;
    for (const l of clean) {
      if (/^#{1,4} /.test(l)) {
        inWriteList = /^#{2,4} *(Creates|Modifies)\b/i.test(l);
        continue;
      }
      if (!inWriteList) continue;
      const path = l.match(/^\s*(?:[-*+]|\d+\.)\s*`(?:\.\/)?([^`]+)`/)?.[1];
      if (path !== undefined && /^\.nax\//.test(path) && !/^\.nax\/scratchpad\//.test(path)) return true;
    }
    return false;
  },
};

let failures = 0;
const dirs = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

if (dirs.length === 0) {
  console.error("eval-mechanical: no fixtures found under fixtures/");
  process.exit(1);
}

for (const name of dirs) {
  const dir = join(fixturesDir, name);
  const specPath = join(dir, "spec.md");
  const expectedPath = join(dir, "expected.json");
  if (!existsSync(specPath) || !existsSync(expectedPath)) {
    console.error(`[FAIL] ${name}: missing spec.md or expected.json`);
    failures++;
    continue;
  }
  let expected;
  try {
    expected = JSON.parse(readFileSync(expectedPath, "utf8"));
  } catch (err) {
    console.error(`[FAIL] ${name}: invalid expected.json (${err.message})`);
    failures++;
    continue;
  }
  const unknown = (expected.mustFire ?? []).filter((id) => !(id in CHECKS));
  if (unknown.length) {
    console.error(`[FAIL] ${name}: expected.json names unknown check(s): ${unknown.join(", ")}`);
    failures++;
    continue;
  }
  const lines = readFileSync(specPath, "utf8").split("\n");
  let prd;
  const prdPath = join(dir, "prd.json");
  if (existsSync(prdPath)) {
    try {
      prd = JSON.parse(readFileSync(prdPath, "utf8"));
    } catch (err) {
      console.error(`[FAIL] ${name}: invalid prd.json (${err.message})`);
      failures++;
      continue;
    }
  }
  const fired = Object.entries(CHECKS)
    .filter(([, check]) => check(lines, prd))
    .map(([id]) => id)
    .sort();
  const want = [...(expected.mustFire ?? [])].sort();
  if (JSON.stringify(fired) === JSON.stringify(want)) {
    console.log(`[OK]   ${name}: fired ${fired.length ? fired.join(", ") : "(none)"}`);
  } else {
    console.error(`[FAIL] ${name}: expected [${want.join(", ")}] but fired [${fired.join(", ")}]`);
    failures++;
  }
}

if (failures) {
  console.error(`eval-mechanical: ${failures} fixture(s) failed`);
  process.exit(1);
}
console.log(`eval-mechanical: ${dirs.length} fixtures passed`);
