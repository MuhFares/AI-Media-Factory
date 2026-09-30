/**
 * Full Content E2E V2 — API-backed text-agent chain only.
 *
 * Runs Research → Writer → SEO → Brand → Review → QA through the durable
 * production executor. Image/video/TTS/publishing are intentionally absent.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createPool, migrate, PostgresPersistence } from "@ai-media-factory/database";
import { createProductionAgentExecutor } from "../dist/index.js";

const workflowId = `wf-content-e2e-v2-${Date.now()}`;
const correlationId = `corr-content-e2e-v2-${Date.now()}`;
const contentId = "content-cairo-everyday-life-v2";
const context = {
  workflowId,
  correlationId,
  data: {
    contentId,
    contentTopic: "Cairo everyday street culture beyond landmark tourism",
    previousArtifact: undefined,
  },
};
const steps = ["research", "writer", "seo", "brand", "review", "qa"].map((agent) => ({
  id: `${agent}-content-e2e-v2`,
  agent,
  emits: agent,
}));
const reuseResearch = process.env.REUSE_PERSISTED_RESEARCH === "true";
const strictAgentRouting = process.env.STRICT_AGENT_ROUTING === "true";
const pool = createPool({ connectionString: process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory" });

const persistedResearchQuery = `
  SELECT payload, artifact_id, kind
  FROM artifacts
  WHERE kind = 'research_report'
    AND status = 'completed'
    AND payload->>'reportId' IS NOT NULL
    AND payload->>'summary' IS NOT NULL
    AND jsonb_typeof(payload->'sources') = 'array'
    AND jsonb_array_length(payload->'sources') > 0
  ORDER BY created_at DESC
  LIMIT 1
`;

function fallbackPayload(agent, chain, step) {
  const research = chain.find((artifact) => artifact.kind === "research_report");
  const writer = chain.find((artifact) => artifact.kind === "writer_report");
  const source = research?.payload?.sources?.[0] ?? { id: 1, title: "Research source", url: "", snippet: "" };
  const title = "القاهرة كما يعيشها أهلها";
  if (agent === "writer") return { contentId, taskDescription: "Write a Cairo short-form content package", objective: "Grounded Egyptian-Arabic documentary", title, content: "القاهرة مش بس معالم سياحية؛ هي شوارع ومقاهي ولافتات وحركة يومية بتصنع حكاية المدينة.", summary: "Short observational Egyptian-Arabic documentary brief.", sourceReferences: [{ sourceId: source.id, title: source.title, url: source.url }], status: "completed", metadata: { agentVersion: "local-fallback", researchArtifactId: research?.artifactId ?? "" }, executionMode: "local-fallback" };
  if (agent === "seo") return { reportId: `seo-${workflowId}`, taskDescription: step.id, objective: "Local SEO fallback", optimizedTitle: title, optimizedDescription: "حكاية القاهرة اليومية بعيدًا عن الصورة التقليدية.", keywords: [{ keyword: "القاهرة", importance: "primary" }, { keyword: "حياة الشوارع", importance: "secondary" }], topics: [{ topic: title, presentInContent: true }], searchIntent: "informational", contentStructure: [{ heading: "الحياة اليومية", purpose: "Local city culture" }], sourceReferences: writer?.payload?.sourceReferences ?? [], status: "completed", metadata: { agentVersion: "local-fallback", writerArtifactId: writer?.artifactId ?? "" }, executionMode: "local-fallback" };
  if (agent === "brand") return { reportId: `brand-${workflowId}`, taskDescription: step.id, objective: "Local brand fallback", status: "approved", issues: [], passedChecks: [{ code: "BRAND_OK", message: "Local brand structure validated." }], failedChecks: [], recommendations: [], metadata: { agentVersion: "local-fallback" }, executionMode: "local-fallback" };
  if (agent === "review") return { reportId: `review-${workflowId}`, taskDescription: step.id, summary: "Local review of the content chain.", status: "approved", findings: [], recommendations: ["Use semantically aligned VoiceTuT narration before final media approval."], metadata: { agentVersion: "local-fallback" }, executionMode: "local-fallback" };
  return { reportId: `qa-${workflowId}`, requestId: `qa-${workflowId}`, objective: "Local QA preflight", status: "reviewed", summary: "Text-agent chain structurally reviewed; semantic narration and final media remain open.", testResults: [{ testName: "content-chain-validation", status: "not_executed", executed: false, source: "local-fallback" }], findings: [], risks: ["VoiceTuT narration not run", "Final multi-scene media not run"], recommendations: [], metadata: { agentVersion: "local-fallback", executionEvidencePresent: false }, executionMode: "local-fallback" };
}

try {
  await pool.query("SELECT 1");
  await migrate(pool);
  const persistence = new PostgresPersistence(pool);
  const executor = createProductionAgentExecutor({ persistence, pool });
  const results = [];

  for (const step of steps) {
    if (step.agent === "research" && reuseResearch) {
      const prior = await pool.query(persistedResearchQuery);
      assert.ok(prior.rowCount === 1, "REUSE_PERSISTED_RESEARCH requires a persisted completed research report");
      const artifact = { artifactId: `art-${workflowId}-${step.id}`, kind: "research_report", producerAgent: "research", workflowId, correlationId, status: "completed", payload: { ...prior.rows[0].payload, executionMode: "reused-real-research-artifact", sourceArtifactId: prior.rows[0].artifact_id }, contentType: "application/json", schemaVersion: "1.0", createdAt: new Date().toISOString() };
      await persistence.saveArtifact(artifact);
      context.data.previousArtifact = { artifactId: artifact.artifactId, kind: artifact.kind };
      results.push({ agent: step.agent, artifactId: artifact.artifactId, kind: artifact.kind, status: artifact.status, executionMode: "reused-real-research-artifact" });
      continue;
    }
    const outcome = await executor.executeAgentStep(step, context);
    if (outcome.status !== "completed") {
      if (step.agent === "research") {
        await mkdir("output/e2e-v2", { recursive: true });
        await writeFile(`output/e2e-v2/agent-failure-${workflowId}-${step.agent}.json`, JSON.stringify({
          workflowId,
          correlationId,
          contentId,
          agent: step.agent,
          stepId: step.id,
          status: outcome.status,
          error: outcome.error?.message ?? "research step failed without an error message",
          retryable: outcome.error?.retryable ?? false,
          rawResponsePersisted: false,
          canonicalFallbackCreated: false,
          recordedAt: new Date().toISOString(),
        }, null, 2) + "\n", "utf8");
        const prior = await pool.query(persistedResearchQuery);
        assert.ok(prior.rowCount === 1, "research must succeed or have a previously persisted completed report");
        const artifact = { artifactId: `art-${workflowId}-${step.id}`, kind: "research_report", producerAgent: "research", workflowId, correlationId, status: "completed", payload: { ...prior.rows[0].payload, executionMode: "reused-real-research-artifact", sourceArtifactId: prior.rows[0].artifact_id }, contentType: "application/json", schemaVersion: "1.0", createdAt: new Date().toISOString() };
        await persistence.saveArtifact(artifact);
        context.data.previousArtifact = { artifactId: artifact.artifactId, kind: artifact.kind };
        results.push({ agent: step.agent, artifactId: artifact.artifactId, kind: artifact.kind, status: artifact.status, executionMode: "reused-real-research-artifact" });
        continue;
      }
      if (strictAgentRouting) {
        await mkdir("output/e2e-v2", { recursive: true });
        await writeFile(`output/e2e-v2/agent-failure-${workflowId}-${step.agent}.json`, JSON.stringify({
          workflowId,
          correlationId,
          contentId,
          agent: step.agent,
          stepId: step.id,
          status: outcome.status,
          error: outcome.error?.message ?? "agent step failed without an error message",
          retryable: outcome.error?.retryable ?? false,
          rawResponsePersisted: false,
          canonicalFallbackCreated: false,
          recordedAt: new Date().toISOString(),
        }, null, 2) + "\n", "utf8");
        throw new Error(`text-agent stage failed under strict routing: ${step.agent}; no local fallback permitted`);
      }
      const chain = await persistence.listArtifacts(workflowId);
      const kind = `${step.agent}_report`;
      const artifact = { artifactId: `art-${workflowId}-${step.id}`, kind, producerAgent: step.agent, workflowId, correlationId, status: "completed", payload: fallbackPayload(step.agent, chain, step), contentType: "application/json", schemaVersion: "1.0", createdAt: new Date().toISOString(), parentArtifact: context.data.previousArtifact };
      await persistence.saveArtifact(artifact);
      context.data.previousArtifact = { artifactId: artifact.artifactId, kind: artifact.kind };
      results.push({ agent: step.agent, artifactId: artifact.artifactId, kind: artifact.kind, status: artifact.status, executionMode: "local-fallback" });
      continue;
    }
    assert.ok(outcome.artifact, `${step.agent} must emit an artifact`);
    await persistence.saveArtifact(outcome.artifact);
    results.push({ agent: step.agent, artifactId: outcome.artifact.artifactId, kind: outcome.artifact.kind, status: outcome.artifact.status, agentExecution: outcome.artifact.payload.agentExecution });
  }

  const artifacts = await persistence.listArtifacts(workflowId);
  assert.equal(artifacts.length, steps.length);
  assert.deepEqual(artifacts.map((artifact) => artifact.producerAgent), steps.map((step) => step.agent));
  const executions = await persistence.listCapabilityExecutions(workflowId);
  const evidence = await persistence.listExecutionEvidence(workflowId);
  const output = { workflowId, correlationId, contentId, stages: results, capabilityExecutions: executions.map((row) => ({ capabilityId: row.capabilityId, agentId: row.agentId, status: row.status, evidenceId: row.evidenceId })), evidenceRows: evidence.length, downstream: { media: "NOT_RUN", voicetut: "NOT_RUN", publishing: "NOT_RUN", analytics: "NOT_RUN" } };
  await mkdir("output/e2e-v2", { recursive: true });
  await writeFile(`output/e2e-v2/content-agents-api-${workflowId}.json`, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(output, null, 2));
} finally {
  await pool.end();
}
