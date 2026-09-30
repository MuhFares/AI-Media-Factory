/**
 * Slice 6 — deterministic Morroway strategic reconciliation V1.
 *
 * Reconciles canonical persisted sources (docs/artifacts/approved records)
 * into first-class strategic entities. Deterministic, provider-free.
 *
 *   node scripts/reconcile-strategy-morroway-v1.mjs           # dry-run (default)
 *   node scripts/reconcile-strategy-morroway-v1.mjs --apply   # persist PROPOSED-only
 *
 * Safety: dry-run writes nothing. --apply creates PROPOSED (never ACTIVE)
 * entities only, idempotently: a spec whose canonical payload already
 * matches the latest version is SKIPPED, never duplicated. No activations,
 * no approvals, no artifact/command mutation — activation stays Owner-only
 * via the existing Strategy review UI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");
const { StrategicStore, canonicalJson } = require("@ai-media-factory/database");
const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "morroway";
const CREATED_BY = "slice6-reconciliation-v1";
const APPLY = process.argv.includes("--apply");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(REPO, ".env");
  if (!fs.existsSync(envFile)) throw new Error("reconcile: DATABASE_URL unavailable (no env, no .env)");
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === "DATABASE_URL") {
      let raw = line.slice(i + 1).trim();
      if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
      return raw;
    }
  }
  throw new Error("reconcile: DATABASE_URL unavailable");
}

// -- canonical specs: every claim carries its persisted source -------------
const SPECS = [
  {
    entityType: "BRAND", entityKey: "primary",
    sourceArtifactIds: [
      "docs/brand-and-channel-naming-v1.md",
      "docs/brand-architecture-and-naming-hierarchy-v1.md",
      "artifacts/brand-architecture-v1.json",
      "docs/morroway-brand-identity-v1.md",
      "docs/morroway-visual-identity-production-v1.md",
      "docs/morroway-final-palette-and-typography-v1.md",
      "artifacts/brand/morroway/v1/brand-assets-manifest.json",
      "artifacts/reviews/brand-and-channel-naming-v1-final-decision.xlsx",
    ],
    claims: [
      ["master brand Morroway APPROVED", "naming §26 + hierarchy §18 (Owner final selection CLOSED)"],
      ["Naming V1 CLOSED, winner Morroway; Remnara reserve; Veilward hold; Aeon+Nexora dropped", "naming §25-§26"],
      ["brand-architecture PENDING_SELECTION SUPERSEDED for selection only", "Owner final decision (artifact layers stay approved history)"],
      ["legal NOT_FINALIZED; handle NOT_SELECTED_OR_RESERVED; domain NOT_SELECTED_OR_REGISTERED; trademark NOT_COMPLETED; tagline NOT_APPROVED", "naming §26 + hierarchy §18"],
      ["essence + Threshold primary / Cinematic Worlds secondary", "identity doc + visual-identity OWNER_DIRECT_DIRECTION"],
      ["logo/palette/typography APPROVED", "assets manifest OWNER_APPROVED + palette OWNER_APPROVED"],
    ],
    payload: {
      brand: "Morroway",
      brandStatus: "APPROVED_MASTER_BRAND",
      naming: {
        status: "CLOSED", round: "V1", winner: "Morroway",
        reserveFinalist: "Remnara", holdArchived: ["Veilward"], dropped: ["Aeon", "Nexora"],
        decisionBasis: "OWNER_DIRECT_DECISION 2026-09-09",
      },
      selectionSupersession: "consumerMasterBrandPolicy.status PENDING_SELECTION in artifacts/brand-architecture-v1.json is SUPERSEDED for the selection question by the Owner final decision; architecture layers remain approved history.",
      operatingParent: "AI Media Factory / AMF (corporate and operating parent; not the consumer brand)",
      legalEntity: { status: "NOT_FINALIZED" },
      handle: { preferred: "@morroway", status: "NOT_SELECTED_OR_RESERVED" },
      domain: { status: "NOT_SELECTED_OR_REGISTERED", knownTaken: ["morroway.com"], notedOnly: ["morroway.media", "morroway.studio", "getmorroway.com"], note: "noted only, NOT approved" },
      trademark: { status: "NOT_COMPLETED", applications: 0, note: "preliminary screening is not legal clearance" },
      tagline: { status: "NOT_APPROVED" },
      essence: "A journey through time and imagination.",
      identityDirection: { primary: "Threshold", secondary: "Cinematic Worlds", status: "APPROVED_DIRECTION", basis: "OWNER_DIRECT_DIRECTION" },
      logo: { status: "APPROVED", primaryAsset: "artifacts/brand/morroway/v1/master/morroway-logo-primary.png", manifest: "artifacts/brand/morroway/v1/brand-assets-manifest.json", approvalBasis: "OWNER_DIRECT_VISUAL_DECISION", wordmark: "lowercase, Outfit foundation + customization" },
      palette: { status: "APPROVED", base: ["#0B0F1A Abyssal", "#000000 Cinematic Black (permitted neutral)", "#EDEBE6 White", "#9E9E9E Silver", "#1E2A3A Deep", "#C99867 Amber restrained 5-10%"], approvalArtifact: "art-brand-morroway-palette-approval-b5db9a15" },
      typography: { status: "APPROVED", display: "Outfit", body: "Plex Sans", arabic: "Plex Sans Arabic primary, Cairo alternate" },
      positioning: "Use Morroway as the audience-facing storytelling brand; AMF is the operating parent.",
      prohibitions: ["Morroway is not Morrowind", "Morroway is not Elder Scrolls", "Do not treat Morroway as a game, game franchise, gameplay setting, or existing fictional universe", "Do not use invented lore for a Historical POV request"],
      contentPillars: ["REAL-WORLD HISTORICAL POV / source-supported historical perspective storytelling", "ORIGINAL AI-GENERATED FANTASY / emotional imaginative storytelling"],
      projectPurpose: "consumer media and storytelling brand",
      historicalPovRule: "For a Historical POV request, use real historical people, civilizations, documented events, or source-supported settings. Never substitute fantasy.",
    },
  },
  {
    entityType: "CONTENT_SYSTEM", entityKey: "primary",
    sourceArtifactIds: [
      "docs/morroway-adaptive-pilot-content-system-v1.md",
      "artifacts/brand/morroway/v1/manifests/morroway-adaptive-pilot-content-system-v1.json",
      "docs/strategy-council-v2-milestone.md",
    ],
    claims: [
      ["READY_FOR_INITIAL_LEARNING_BATCH; PERFORMANCE_LED + AGENT_RECOMMENDED + OWNER_GOVERNED", "pilot doc header"],
      ["pilot adaptive (model/size/duration); state planning", "pilot doc + strategy payloads"],
      ["4 batch IDs are initial batch only", "pilot doc table + strategy learningBatchNote"],
      ["sourcing policies per pillar; QA + Owner approval before publication", "pilot doc"],
      ["gates are hypotheses, NOT KPIs; promotion owner-governed", "pilot doc + strategy gatesNote"],
    ],
    payload: {
      status: "READY_FOR_INITIAL_LEARNING_BATCH",
      decisionModel: ["PERFORMANCE_LED", "AGENT_RECOMMENDED", "OWNER_GOVERNED"],
      pillars: ["REAL-WORLD HISTORICAL POV / source-supported historical perspective storytelling", "ORIGINAL AI-GENERATED FANTASY / emotional imaginative storytelling"],
      pilot: { model: "adaptive", size: "ADAPTIVE", duration: "ADAPTIVE", state: "planning" },
      learningBatch: {
        note: "initial learning batch only, NOT permanent pilot size",
        items: [
          { id: "MW-HIS-001", pillar: "Historical", focus: "Sensory-first, source-supported POV", duration: "35-50s" },
          { id: "MW-HIS-002", pillar: "Historical", focus: "Curiosity hook with delayed factual reveal", duration: "40-55s" },
          { id: "MW-FAN-001", pillar: "Fantasy", focus: "Immediate impossible visual reveal", duration: "25-40s" },
          { id: "MW-FAN-002", pillar: "Fantasy", focus: "Character-led emotional premise", duration: "35-50s" },
        ],
      },
      sourcing: {
        historicalPov: "must use real-world/source-supported history; research sign-off before scripting",
        fantasy: "original AI-generated storytelling",
      },
      gates: {
        note: "Experimental performance gates are hypotheses, NOT permanent KPIs",
        promotion: "evidence-based and owner-governed",
        scaleDecisions: ["Scale", "Continue", "Iterate", "Retest", "Pause", "Retire"],
      },
      governance: { qaRequired: true, ownerApprovalBeforePublication: true },
      operatingLoop: ["IDEA", "RESEARCH", "CONTENT BRIEF", "SCRIPT", "VISUAL PLAN", "PRODUCTION", "QA", "OWNER APPROVAL", "PUBLISH", "MEASURE", "PERFORMANCE ANALYSIS", "AGENT REVIEW", "OWNER REVIEW / OPTIONAL OVERRIDE", "NEXT ACTION"],
      productionNote: "No content produced or published in this phase; no social account created. Production/publication authority is operational truth, never granted by this entity.",
    },
  },
  {
    entityType: "STRATEGY", entityKey: "primary",
    sourceArtifactIds: [
      "docs/strategy-council-v2-milestone.md",
      "docs/morroway-adaptive-pilot-content-system-v1.md",
      "docs/morroway-brand-identity-v1.md",
    ],
    claims: [
      ["Council CLOSED; Owner decision APPROVED_WITH_CHANGES", "milestone header"],
      ["global short-form territory; pillars Historical POV + AI Fantasy; deferred Long-form/Documentary", "milestone CEO synthesis"],
      ["Instagram Reels first; YouTube Shorts then TikTok (PHASED_PORTFOLIO)", "milestone channel section"],
      ["30s Reel + 15s AI visual; modular production", "milestone content section"],
      ["essence; adaptive pilot; experimental gates; 4-item batch note", "carried from STRATEGY v2"],
    ],
    payload: {
      councilStatus: "CLOSED",
      ownerDecision: "APPROVED_WITH_CHANGES",
      consumerDirection: "global short-form",
      territory: "Short-form historical POV and AI-generated fantasy storytelling",
      contentPillars: ["REAL-WORLD HISTORICAL POV / source-supported historical perspective storytelling", "ORIGINAL AI-GENERATED FANTASY / emotional imaginative storytelling"],
      deferred: ["Long-form", "Documentary"],
      platforms: { primary: "Instagram Reels first", expansion: ["YouTube Shorts (after traction 4-8w)", "TikTok (after Shorts 8-12w)"], model: "PHASED_PORTFOLIO" },
      format: { direction: "short-form", reel: "30s", aiVisual: "15s" },
      operatingModel: "modular production (script/visual/voice/editing reusable templates)",
      essence: "A journey through time and imagination.",
      essenceBasis: "morroway-brand-identity-v1.md (OWNER_BRAND_IDENTITY_REVIEW_REQUIRED - pending final review, no conflicting source)",
      pilot: {
        model: "adaptive",
        gatesNote: "Experimental performance gates are hypotheses, NOT permanent KPIs",
        approvalBasis: "strategy-council-v2 (APPROVED_WITH_CHANGES, pilot-only gates)",
        learningBatch: 4,
        learningBatchNote: "4 items = initial learning batch, NOT permanent fixed pilot size",
      },
    },
  },
  {
    entityType: "EXPERIMENT", entityKey: "pilot-gates",
    sourceArtifactIds: [
      "docs/strategy-council-v2-milestone.md",
      "docs/morroway-adaptive-pilot-content-system-v1.md",
    ],
    claims: [
      ["gates recorded as hypotheses with observed trigger metrics", "milestone channel/growth sections"],
      ["promotion to permanent KPI requires governed Owner decision", "governance rule, not a source quote"],
    ],
    payload: {
      hypothesis: "pilot performance gates",
      status: "EXPERIMENTAL",
      observedTriggers: ["5% engagement across 10 Reels", "10k views threshold", "10% weekly follower growth", "$100 monetization"],
      rule: "hypotheses, NOT permanent KPIs; promotion to permanent only via governed Owner decision",
      validScaleDecisions: ["Scale", "Continue", "Iterate", "Retest", "Pause", "Retire"],
    },
  },
];

/**
 * Pure idempotency planner (unit-testable, no DB): SKIP when the latest
 * version already carries the canonical payload, else PROPOSE next version.
 */
export function planSpec(latest, spec) {
  if (latest !== null && latest !== undefined
    && canonicalJson(latest.payload) === canonicalJson(spec.payload)) {
    return { action: "SKIP" };
  }
  return { action: "PROPOSE", version: (latest?.version ?? 0) + 1 };
}

export { SPECS };

async function main() {
  const pool = new pg.Pool({ connectionString: loadDatabaseUrl() });
  const strategic = new StrategicStore(pool);
  const report = [];
  try {
    for (const spec of SPECS) {
      const history = await strategic.history(PROJECT, spec.entityType, spec.entityKey, 10);
      const latest = history[0] ?? null;
      const plan = planSpec(latest, spec);
      for (const [claim, source] of spec.claims) {
        report.push(`claim | ${spec.entityType}/${spec.entityKey} | ${claim} | source: ${source}`);
      }
      if (plan.action === "SKIP") {
        report.push(`SKIP identical | ${spec.entityType}/${spec.entityKey} v${latest.version} ${latest.status} | payload hash matches; idempotent no-op`);
        continue;
      }
      if (!APPLY) {
        report.push(`WOULD_PROPOSE | ${spec.entityType}/${spec.entityKey} v${plan.version} PROPOSED | latest: ${latest ? `v${latest.version} ${latest.status}` : "none"}`);
        continue;
      }
      const created = await strategic.propose({
        projectId: PROJECT, entityType: spec.entityType, entityKey: spec.entityKey,
        payload: spec.payload, sourceArtifactIds: spec.sourceArtifactIds, createdBy: CREATED_BY,
      });
      report.push(`PROPOSED | ${created.entityType}/${created.entityKey} ${created.entityId} v${created.version} | supersedes v${created.supersedesVersion ?? "-"} | authority: Owner activation required (not effective)`);
    }
    const { active, conflicts } = await strategic.effectiveState(PROJECT);
    report.push(`effective | ACTIVE: ${active.map((e) => `${e.entityType}/${e.entityKey}@v${e.version}`).join(", ") || "none"}`);
    report.push(conflicts.length ? `CONFLICTS | ${JSON.stringify(conflicts)}` : "conflicts | none");
    // Slice 6 §22 validation (read-only, from canonical state).
    const find = (t, k = "primary") => active.find((e) => e.entityType === t && e.entityKey === k)?.payload ?? null;
    const brand = find("BRAND"), strategy = find("STRATEGY");
    const checks = [
      ["master brand Morroway APPROVED", brand?.brand === "Morroway"],
      ["strategy council CLOSED + APPROVED_WITH_CHANGES", strategy?.councilStatus === "CLOSED" || strategy?.pilot?.approvalBasis?.includes("APPROVED_WITH_CHANGES")],
      ["pillars Historical POV + AI Fantasy active", Array.isArray(strategy?.contentPillars) && strategy.contentPillars.length >= 2],
      ["pilot adaptive; 4 = initial batch", strategy?.pilot?.model === "adaptive" && String(strategy?.pilot?.learningBatchNote ?? "").includes("NOT permanent")],
      ["gates experimental hypotheses", String(strategy?.pilot?.gatesNote ?? strategy?.gates?.note ?? "").includes("NOT permanent")],
    ];
    for (const [label, ok] of checks) report.push(`validate ${ok ? "PASS" : "OPEN"} | ${label}`);
    report.push("operational authority is NOT part of strategic payloads; production/publication/public read from lifecycle truth in UI.");
    console.log(report.join("\n"));
  } finally {
    await pool.end();
  }
}

if (isMain) {
  main().catch((error) => { console.error(`reconcile FAILED: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
}
