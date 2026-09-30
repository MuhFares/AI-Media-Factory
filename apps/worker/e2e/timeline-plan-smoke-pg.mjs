/**
 * Real local timeline planning proof — zero external cost.
 *
 * Uses the real Egyptian narration that produced voicetut-short.wav (12640ms).
 * Path: Director Agent → timeline.plan → DeterministicTimelinePlanner → evidence → PostgreSQL
 * No FLUX / Wan / VoiceTuT / RunPod / Groq calls.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPool, migrate, PostgresPersistence } from "@ai-media-factory/database";
import { createCapabilityRegistry, createTimelinePlanCapability } from "@ai-media-factory/tool-framework";
import { createDirectorAgent } from "@ai-media-factory/director-agent";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { RoutingCapabilityExecutor, PROVIDER_CAPABILITIES, DEFAULT_PROVIDER_GRANTS } from "@ai-media-factory/provider-adapters";

// Use the exact canonical narration and measured duration when supplied by an E2E run.
const EGYPTIAN_SHORT = process.env.TIMELINE_SCRIPT ?? "بص يا سيدي، الموضوع أبسط بكتير ما الناس متخيلة. النهارده الذكاء الاصطناعي بقى يقدر يساعدنا في كتابة المحتوى وتحليل البيانات وعمل الصور والفيديوهات كمان.";
const NARRATION_DURATION_MS = Number(process.env.TIMELINE_NARRATION_DURATION_MS ?? 12640);

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const WORKFLOW_ID = `wf-timeline-plan-${Date.now()}`;
const CORRELATION_ID = `corr-timeline-plan-${Date.now()}`;
const REQUEST_ID = `req-timeline-plan-${Date.now()}`;

const pool = createPool({ connectionString: DATABASE_URL });
try { await pool.query("SELECT 1"); } catch (e) {
  console.log("timeline-plan-smoke-pg: BLOCKED — Postgres unreachable:", e?.message ?? String(e));
  await pool.end().catch(() => {});
  process.exit(42);
}

let timelinePlanForReport = null;

try {
  await migrate(pool);
  const persistence = new PostgresPersistence(pool);

  const resolver = createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants: DEFAULT_PROVIDER_GRANTS });
  const routing = new RoutingCapabilityExecutor();
  routing.register("timeline.plan", createTimelinePlanCapability({ resolver }));
  const boundary = new RuntimeCapabilityExecutor({ resolver, executor: routing });

  const agent = createDirectorAgent({
    execute: async () => { throw new Error("LLM must not be used by director"); },
    capabilityExecution: boundary,
    config: { model: "deterministic", systemPrompt: "" },
  });

  console.log(`timeline-plan-smoke-pg: planning Egyptian narration (${EGYPTIAN_SHORT.length} chars, ${NARRATION_DURATION_MS}ms)…`);
  const t0 = Date.now();
  const outcome = await agent.execute(
    {
      context: { turnId: REQUEST_ID },
      input: {
        requestId: REQUEST_ID,
        objective: "Plan timeline for Egyptian narration",
        script: EGYPTIAN_SHORT,
        narrationDurationMs: NARRATION_DURATION_MS,
        language: "ar",
        dialect: "egyptian",
        audience: "egypt",
        culturalContext: "egyptian",
        visualStyle: process.env.TIMELINE_VISUAL_STYLE ?? "authentic Cairo everyday street documentary, semantically match each narration slice",
        workflowId: WORKFLOW_ID,
        correlationId: CORRELATION_ID,
      },
    },
    { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} },
  );
  const wallMs = Date.now() - t0;
  const report = outcome.output;
  console.log(`timeline-plan-smoke-pg: director_report status=${report.status} (${wallMs}ms wall)`);

  const executions = Array.isArray(report.capabilityExecutions) ? report.capabilityExecutions : [];
  const execution = executions[0];
  assert.ok(execution, "capability execution must be present");

  if (execution.status !== "success") {
    console.log(`timeline-plan-smoke-pg: FAILED — ${execution.error?.message ?? execution.reason ?? report.summary}`);
    assert.equal(execution.evidence?.succeeded, false);
    process.exit(1);
  }

  assert.equal(execution.evidence.providerInvoked, true);
  assert.equal(execution.evidence.succeeded, true);
  assert.equal(execution.evidence.capabilityId, "timeline.plan");
  assert.equal(execution.evidence.agentId, "director");
  assert.equal(execution.evidence.workflowId, WORKFLOW_ID);
  assert.equal(execution.evidence.correlationId, CORRELATION_ID);
  // No external provider was invoked — planner is deterministic-v2
  assert.ok(!execution.evidence.providerId || execution.evidence.providerId === "deterministic-v2");

  const plan = execution.output;
  timelinePlanForReport = plan;

  // Acceptance gates
  assert.equal(plan.narrationDurationMs, NARRATION_DURATION_MS);
  assert.ok(plan.sceneCount >= 2, `scene count ${plan.sceneCount} should be >=2 for 12.6s`);
  assert.equal(plan.scenes[0].startMs, 0);
  assert.equal(plan.scenes[plan.scenes.length - 1].endMs, NARRATION_DURATION_MS);
  assert.ok(plan.plannedVisualDurationMs >= NARRATION_DURATION_MS);
  assert.ok(plan.coverageRatio >= 1.0);
  for (let i = 1; i < plan.scenes.length; i++) assert.equal(plan.scenes[i].startMs, plan.scenes[i - 1].endMs, "no gaps/overlaps");
  for (const s of plan.scenes) {
    assert.ok(s.durationMs > 0);
    assert.ok(s.imagePrompt.length > 20);
    assert.ok(s.motionPrompt.length > 10);
    assert.equal(s.speakingMode, "voiceover");
    assert.equal(s.negativePrompt.includes("speaking"), true);
  }
  assert.match(plan.timelineId, /^timeline-[a-f0-9]{12}$/);

  // Persist
  await persistence.saveCapabilityExecution({
    resultId: String(execution.resultId), workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID,
    capabilityId: "timeline.plan", agentId: "director", status: "success",
    evidenceId: String(execution.evidence.evidenceId), idempotencyKey: String(execution.resultId),
    executedAt: String(execution.evidence.executedAt), payload: execution,
  });
  await persistence.saveExecutionEvidence({
    evidenceId: String(execution.evidence.evidenceId), workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID,
    capabilityId: "timeline.plan", agentId: "director", executedAt: String(execution.evidence.executedAt),
    succeeded: true, idempotencyKey: String(execution.evidence.evidenceId), payload: execution,
  });

  const reloadPool = createPool({ connectionString: DATABASE_URL });
  const readPersistence = new PostgresPersistence(reloadPool);
  const rows = await readPersistence.listExecutionEvidence(WORKFLOW_ID);
  const evRow = rows.find((e) => e.capabilityId === "timeline.plan");
  assert.ok(evRow, "evidence durable");
  assert.equal(evRow.succeeded, true);
  await persistence.saveExecutionEvidence({
    evidenceId: String(execution.evidence.evidenceId), workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID,
    capabilityId: "timeline.plan", agentId: "director", executedAt: String(execution.evidence.executedAt),
    succeeded: true, idempotencyKey: String(execution.evidence.evidenceId), payload: execution,
  });
  const rows2 = await readPersistence.listExecutionEvidence(WORKFLOW_ID);
  assert.equal(rows2.filter((e) => e.capabilityId === "timeline.plan").length, 1, "idempotent");
  await reloadPool.end();
  console.log("timeline-plan-smoke-pg: evidence durable + idempotent (fresh pool reload)");

  // Human-readable timeline
  console.log(`\ntimeline-plan-smoke-pg: PASS — real timeline planned`);
  console.log(`  timelineId: ${plan.timelineId}`);
  console.log(`  scenes: ${plan.sceneCount}  visual ${plan.plannedVisualDurationMs}ms  coverage ${plan.coverageRatio.toFixed(2)}  timingSource=${plan.timingSource}`);
  console.log(`  characters: ${plan.characters.map((c) => `${c.id}(${c.role})`).join(", ") || "none"}`);
  console.log(`  generation: ${plan.generationSummary.imageCount} images, ${plan.generationSummary.videoClipCount} clips, est ${plan.generationSummary.estimatedGeneratedVideoDurationMs}ms video`);
  console.log(`  workflowId: ${WORKFLOW_ID}`);
  console.log(`  evidenceId: ${execution.evidence.evidenceId}`);
  console.log(`\n--- HUMAN TIMELINE ---\n`);
  for (const s of plan.scenes) {
    const fmt = (ms) => `${String(Math.floor(ms/60000)).padStart(2,"0")}:${String(Math.floor((ms%60000)/1000)).padStart(2,"0")}.${String(ms%1000).padStart(3,"0")}`;
    console.log(`SCENE ${s.sceneId}  ${fmt(s.startMs)} → ${fmt(s.endMs)}  (${s.durationMs}ms)  [${s.visualType}]`);
    console.log(`Narration: "${s.narration.text}"`);
    console.log(`Purpose: ${s.purpose}`);
    console.log(`Visual: ${s.visualDescription} — ${s.characters.length ? `characters: ${s.characters.join(",")}` : "no characters"}`);
    console.log(`Image: ${s.imagePrompt}`);
    console.log(`Motion: ${s.motionPrompt}`);
    console.log(`Negative: ${s.negativePrompt}`);
    console.log(`Camera: ${s.camera.shotType} / ${s.camera.movement}  Mood: ${s.mood}  Speaking: ${s.speakingMode}`);
    console.log(`Generation: ${s.generation.targetDurationMs}ms clip  image=${s.generation.requiresImageGeneration} video=${s.generation.requiresVideoGeneration}`);
    console.log(`---`);
  }

  // Save machine-readable JSON
  const outDir = path.resolve("output/timeline");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${plan.timelineId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2));
  console.log(`\n  JSON: ${outPath}`);

  // Warnings if any
  if (plan.warnings.length > 0) console.log(`\n  Warnings: ${plan.warnings.join("; ")}`);

} finally {
  await pool.end().catch(() => {});
}
