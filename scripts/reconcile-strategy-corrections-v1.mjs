/**
 * Slice 6 final reconciliation — Owner-accepted corrections V1.
 *
 * Creates the minimum next PROPOSED versions for two accepted findings
 * (stale identity-review marker; rigid platform-timing reading) plus the
 * duration-semantics clarification. Deterministic, provider-free.
 *
 *   node scripts/reconcile-strategy-corrections-v1.mjs           # dry-run
 *   node scripts/reconcile-strategy-corrections-v1.mjs --apply   # persist PROPOSED-only
 *
 * Rules: never mutate a version in place (transforms build new payloads
 * from the live latest, preserving originals inside superseded* fields);
 * idempotent (SKIP when canonical payload already matches); PROPOSED-only
 * (no approval, no activation); no authority grants; no external calls.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");
const { StrategicStore, canonicalJson } = require("@ai-media-factory/database");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "morroway";
const CREATED_BY = "slice6-corrections-v1";
const APPLY = process.argv.includes("--apply");
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(REPO, ".env");
  if (!fs.existsSync(envFile)) throw new Error("corrections: DATABASE_URL unavailable (no env, no .env)");
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === "DATABASE_URL") {
      let raw = line.slice(i + 1).trim();
      if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
      return raw;
    }
  }
  throw new Error("corrections: DATABASE_URL unavailable");
}

function clone(value) {
  return JSON.parse(canonicalJson(value) === "null" ? "null" : JSON.stringify(value));
}

/**
 * Finding A: the identity-doc REVIEW_REQUIRED marker predates the Owner
 * direct decisions that settled essence/direction/logo/palette/typography.
 * Preserve the original text; record component-level supersession; keep
 * tagline NOT_APPROVED as state (never a task); name no decision ID.
 */
export function correctStrategyIdentityMarker(payload) {
  const next = clone(payload);
  if (next.essenceReview?.status === "SUPERSEDED_FOR_DECIDED_COMPONENTS"
    && typeof next.essenceBasis === "string"
    && next.essenceBasis.startsWith("morroway-brand-identity-v1.md was the essence source")) {
    return next;
  }
  const original = typeof next.essenceBasis === "string" ? next.essenceBasis : "";
  next.essenceBasis = "morroway-brand-identity-v1.md was the essence source. Its OWNER_BRAND_IDENTITY_REVIEW_REQUIRED marker (pending final review at the time) is SUPERSEDED for essence, identity direction, logo, palette, and typography by subsequent Owner direct decisions: visual-identity APPROVED_DIRECTION (Threshold primary / Cinematic Worlds secondary), brand assets manifest OWNER_APPROVED, palette and typography OWNER_APPROVED. Tagline remains NOT_APPROVED as its own recorded state, not a pending review task. Original text preserved in essenceReview and history.";
  next.essenceReview = {
    status: "SUPERSEDED_FOR_DECIDED_COMPONENTS",
    decidedComponents: ["essence", "identityDirection", "logo", "palette", "typography"],
    decidedBasis: ["OWNER_DIRECT_DIRECTION (visual identity)", "OWNER_DIRECT_VISUAL_DECISION (assets manifest)", "palette/typography OWNER_APPROVED"],
    openItem: "tagline NOT_APPROVED (recorded state, not a task)",
    actionableDecisionId: null,
    supersededMarkerText: original,
  };
  return next;
}

/**
 * Finding B: expansion windows must read as indicative hypotheses under the
 * adaptive/performance-led model — never automatic calendar gates.
 */
export function correctStrategyExpansionTiming(payload) {
  const next = clone(payload);
  const exp = next.platforms?.expansion;
  const alreadyIndicative = Array.isArray(exp) && exp.length > 0
    && exp.every((e) => e !== null && typeof e === "object" && typeof e.platform === "string" && typeof e.timing === "string");
  if (alreadyIndicative) {
    next.platforms.expansionRule ??= "Expansion decisions are evidence/performance-led and Owner-governed; elapsed time alone authorizes nothing.";
    if (!Array.isArray(next.platforms.supersededTimingText)) next.platforms.supersededTimingText = [];
    return next;
  }
  const originalExpansion = Array.isArray(next.platforms?.expansion) ? next.platforms.expansion.map(String) : [];
  next.platforms = {
    ...(next.platforms ?? {}),
    primary: "Instagram Reels first (initial primary platform)",
    expansion: [
      { platform: "YouTube Shorts", timing: "indicative planning hypothesis only (originally noted 4-8w post-traction); expansion is evidence/performance-led and Owner-governed, never automatic on elapsed weeks" },
      { platform: "TikTok", timing: "indicative planning hypothesis only (originally noted 8-12w post-Shorts); expansion is evidence/performance-led and Owner-governed, never automatic on elapsed weeks" },
    ],
    expansionRule: "Expansion decisions are evidence/performance-led and Owner-governed; elapsed time alone authorizes nothing.",
    supersededTimingText: originalExpansion,
  };
  return next;
}

/** Owner clarification G: item ranges vs format archetypes, explicitly non-conflicting. */
export function clarifyContentDurationSemantics(payload) {
  const next = clone(payload);
  next.durationSemantics = {
    itemDurations: "per-item experiment ranges for the initial learning batch (e.g. 35-50s); they describe experiment bounds, not format targets",
    archetypes: "30s Reel / 15s AI visual format targets (see STRATEGY format)",
    rule: "item ranges neither redefine nor override archetypes; on any conflict archetypes govern unless the Owner decides otherwise",
  };
  return next;
}

export function strategyFormatArchetypeNote(payload) {
  const next = clone(payload);
  next.format = {
    ...(next.format ?? {}),
    note: "30s Reel / 15s AI visual are format archetypes; learning-batch item ranges may vary per experiment (see CONTENT_SYSTEM durationSemantics) and neither redefine nor override archetypes.",
  };
  return next;
}

const CORRECTIONS = [
  {
    entityType: "STRATEGY",
    entityKey: "primary",
    sourceArtifactIds: ["docs/morroway-brand-identity-v1.md", "docs/morroway-visual-identity-production-v1.md", "docs/morroway-final-palette-and-typography-v1.md", "artifacts/brand/morroway/v1/brand-assets-manifest.json", "docs/strategy-council-v2-milestone.md"],
    findings: ["A: stale identity-review marker → component-level supersession", "B: expansion timing → indicative hypotheses", "G: format archetype note"],
    build: (p) => strategyFormatArchetypeNote(correctStrategyExpansionTiming(correctStrategyIdentityMarker(p))),
  },
  {
    entityType: "CONTENT_SYSTEM",
    entityKey: "primary",
    sourceArtifactIds: ["docs/morroway-adaptive-pilot-content-system-v1.md", "docs/strategy-council-v2-milestone.md"],
    findings: ["G: durationSemantics rule (ranges vs archetypes)"],
    build: (p) => clarifyContentDurationSemantics(p),
  },
];

export function planCorrection(latest, nextPayload) {
  if (latest !== null && latest !== undefined
    && canonicalJson(latest.payload) === canonicalJson(nextPayload)) {
    return { action: "SKIP" };
  }
  return { action: "PROPOSE", version: (latest?.version ?? 0) + 1 };
}

async function main() {
  const pool = new pg.Pool({ connectionString: loadDatabaseUrl() });
  const strategic = new StrategicStore(pool);
  const report = [];
  try {
    for (const spec of CORRECTIONS) {
      const history = await strategic.history(PROJECT, spec.entityType, spec.entityKey, 10);
      const latest = history[0] ?? null;
      if (!latest) {
        report.push(`NO_BASELINE | ${spec.entityType}/${spec.entityKey} has no versions; refusing to invent one`);
        continue;
      }
      const nextPayload = spec.build(latest.payload);
      const plan = planCorrection(latest, nextPayload);
      for (const finding of spec.findings) {
        report.push(`finding | ${spec.entityType}/${spec.entityKey} | ${finding}`);
      }
      if (plan.action === "SKIP") {
        report.push(`SKIP identical | ${spec.entityType}/${spec.entityKey} v${latest.version} ${latest.status} | already carries corrections`);
        continue;
      }
      if (!APPLY) {
        report.push(`WOULD_PROPOSE | ${spec.entityType}/${spec.entityKey} v${plan.version} PROPOSED | from v${latest.version} ${latest.status}`);
        continue;
      }
      const created = await strategic.propose({
        projectId: PROJECT, entityType: spec.entityType, entityKey: spec.entityKey,
        payload: nextPayload, sourceArtifactIds: spec.sourceArtifactIds, createdBy: CREATED_BY,
      });
      report.push(`PROPOSED | ${created.entityType}/${created.entityKey} ${created.entityId} v${created.version} | supersedes v${created.supersedesVersion ?? "-"} | authority: Owner activation required (not effective)`);
    }
    console.log(report.join("\n"));
  } finally {
    await pool.end();
  }
}

if (isMain) {
  main().catch((error) => { console.error(`corrections FAILED: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
}
