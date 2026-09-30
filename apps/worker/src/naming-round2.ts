/**
 * Naming V1 Round 2 governed contracts.
 *
 * This module deliberately contains no transport code.  It prepares and
 * validates the business payloads which the existing governed AgentRouter
 * executor must persist before an owner-authorized live execution.  Keeping
 * this boundary pure makes it impossible for planning, batching, or tests to
 * make an accidental provider call.
 */
import { createHash } from "node:crypto";

export const NAMING_ROUND2_BATCH_MAX = 10;
export const NAMING_ROUND2_STRATEGIST_MAX = 20;
export const NAMING_ROUND2_STRATEGIST_MIN = 12;
export const ROUND1_REFERENCE_NAMES = Object.freeze(["Aeon", "Ember", "Nexora", "Virel", "Mythos", "Heartline", "Lore", "Kairo", "Echoes", "Eldoria"] as const);

export type Round2ModelKey = "CLAUDE" | "SOL";
export type Round2Role = "NAMING_STRATEGIST_CLAUDE" | "NAMING_STRATEGIST_SOL" | "BRAND_EVALUATOR_CLAUDE" | "BRAND_EVALUATOR_SOL" | "LINGUISTIC_CULTURAL_REVIEWER" | "NAMING_SYNTHESIZER";
export type Round2LifecycleStage = "ROUND_2_PREPARED" | "ROUND_2_STRATEGISTS_RUNNING" | "ROUND_2_STRATEGISTS_COMPLETED" | "ROUND_2_MERGED" | "ROUND_2_EVALUATION_RUNNING" | "ROUND_2_EVALUATION_COMPLETED" | "ROUND_2_LINGUISTIC_REVIEW_COMPLETED" | "ROUND_2_SYNTHESIS_COMPLETED" | "OWNER_CROSS_ROUND_REVIEW_REQUIRED";

export type ModelRoute = Readonly<{ model: string; provider: "agentrouter-anthropic" | "agentrouter-openai"; protocol: "ANTHROPIC" | "OPENAI_COMPATIBLE"; runtime: "governed-agentrouter-llm" }>;
export const NAMING_ROUND2_MODEL_ROUTES: Readonly<Record<Round2ModelKey, ModelRoute>> = Object.freeze({
  CLAUDE: Object.freeze({ model: "claude-opus-4-8", provider: "agentrouter-anthropic", protocol: "ANTHROPIC", runtime: "governed-agentrouter-llm" }),
  SOL: Object.freeze({ model: "gpt-5.6-sol", provider: "agentrouter-openai", protocol: "OPENAI_COMPATIBLE", runtime: "governed-agentrouter-llm" }),
});

export type NamingCandidate = Readonly<{
  candidateId: string; name: string; territory: string; pronunciationHint?: string;
  oneLineRationale: string; strategicConnection: string; historicalPillarFit: string;
  fantasyPillarFit: string; masterBrandScalability: string; knownConcern: string;
  generationAgent: string; generationExecutionId: string; generationModel: string;
}>;

export type MergedNamingCandidate = NamingCandidate & Readonly<{ generationModels: readonly string[]; independentConvergence: boolean }>;
export type EvaluationScoreKey = "strategicFit" | "memorability" | "distinctiveness" | "scalability" | "pronunciationSpelling" | "emotionalResonance" | "visualBrandability" | "crossPlatformSuitability" | "discoverability";
export type BenchmarkComparison = "STRONGER_THAN_ROUND1_REFERENCE" | "COMPARABLE_TO_ROUND1_REFERENCE" | "WEAKER_THAN_ROUND1_REFERENCE";
export type NamingEvaluation = Readonly<{
  candidateId: string; name: string; scores: Readonly<Record<EvaluationScoreKey, number>>;
  hardFail: boolean; hardFailReason: string | null; primaryStrength: string; primaryConcern: string;
  benchmarkComparison: BenchmarkComparison; benchmarkReason: string;
}>;
export type LinguisticReview = Readonly<{
  candidateId: string; pronunciationConcern: string; spellingConcern: string; culturalConcern: string;
  internationalUsability: string; semanticAssociation: string; hardFail: boolean; hardFailReason: string | null;
}>;
export type EvaluationBatch = Readonly<{ batchId: string; batchIndex: number; evaluatorRole: "BRAND_EVALUATOR_CLAUDE" | "BRAND_EVALUATOR_SOL"; evaluatorModel: string; parentCandidateSet: string; expectedCandidateIds: readonly string[]; candidates: readonly MergedNamingCandidate[] }>;
export type LinguisticBatch = Readonly<{ batchId: string; batchIndex: number; expectedCandidateIds: readonly string[]; candidates: readonly MergedNamingCandidate[] }>;
export type Round2ArtifactKind = "NamingRound2ClaudeCandidateSet" | "NamingRound2SolCandidateSet" | "NamingRound2MergedCandidateSet" | "NamingRound2EvaluationBatch" | "NamingRound2EvaluationAggregate" | "NamingRound2LinguisticReviewBatch" | "NamingRound2LinguisticReviewAggregate" | "NamingRound2Shortlist";
export type Round2ArtifactEnvelope = Readonly<{ artifactId: string; kind: Round2ArtifactKind; workflowId: string; correlationId: string; round: 2; role: Round2Role; executionId: string; provider: string; requestedModel: string; actualModel?: string | null; parentArtifactIds: readonly string[]; createdAt: string; status: "COMPLETED"; payload: unknown; payloadFingerprint: string }>;

const weights: Readonly<Record<EvaluationScoreKey, number>> = Object.freeze({ strategicFit: 20, memorability: 15, distinctiveness: 13, scalability: 12, pronunciationSpelling: 12, emotionalResonance: 10, visualBrandability: 8, crossPlatformSuitability: 5, discoverability: 5 });
export const NAMING_ROUND2_WEIGHTS = weights;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  return value;
}
/** JSONB-safe payload identity: object key order cannot alter this value. */
export function stableFingerprint(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex"); }

/**
 * Produces the persistable portion of a canonical Round 2 artifact.  The
 * calling governed executor owns provider submission and persistence; it must
 * call verifyRound2ArtifactReload after reloading the saved record.
 */
export function createRound2ArtifactEnvelope(input: Omit<Round2ArtifactEnvelope, "round" | "status" | "payloadFingerprint">): Round2ArtifactEnvelope {
  for (const field of [input.artifactId, input.workflowId, input.correlationId, input.executionId, input.provider, input.requestedModel, input.createdAt]) requireText(field, "Round 2 artifact field");
  if (input.parentArtifactIds.length === 0) throw new Error("Round 2 artifact requires parentArtifactIds");
  const roleModel = input.role.endsWith("_CLAUDE") ? "CLAUDE" : input.role.endsWith("_SOL") ? "SOL" : null;
  if (roleModel) assertRequestedModel(roleModel, input.requestedModel, input.actualModel);
  if (hasForbiddenReasoning(input.payload)) throw new Error("hidden reasoning is not permitted in canonical artifacts");
  return Object.freeze({ ...input, round: 2, status: "COMPLETED", parentArtifactIds: Object.freeze([...input.parentArtifactIds]), payloadFingerprint: stableFingerprint(input.payload) });
}

/** Enforces reload lineage and JSONB-safe equality without relying on key order. */
export function verifyRound2ArtifactReload(expected: Round2ArtifactEnvelope, reloaded: Round2ArtifactEnvelope): void {
  for (const field of ["artifactId", "kind", "workflowId", "correlationId", "round", "role", "executionId", "provider", "requestedModel", "status", "payloadFingerprint"] as const) if (expected[field] !== reloaded[field]) throw new Error(`Round 2 artifact reload mismatch: ${field}`);
  if (reloaded.round !== 2 || reloaded.status !== "COMPLETED") throw new Error("Round 2 artifact reload is not completed");
  if (stableFingerprint(reloaded.payload) !== expected.payloadFingerprint || stableFingerprint(expected.payload) !== stableFingerprint(reloaded.payload)) throw new Error("ROUND_2_ARTIFACT_PAYLOAD_ROUNDTRIP_FAILED");
  if (hasForbiddenReasoning(reloaded.payload)) throw new Error("hidden reasoning found in reloaded artifact");
}

export function nextRound2LifecycleStage(current: Round2LifecycleStage, event: "START_STRATEGISTS" | "STRATEGISTS_COMPLETED" | "MERGED" | "START_EVALUATION" | "EVALUATION_COMPLETED" | "LINGUISTIC_COMPLETED" | "SYNTHESIS_COMPLETED" | "OWNER_GATE"): Round2LifecycleStage {
  const transitions: Readonly<Record<Round2LifecycleStage, Partial<Record<string, Round2LifecycleStage>>>> = {
    ROUND_2_PREPARED: { START_STRATEGISTS: "ROUND_2_STRATEGISTS_RUNNING" },
    ROUND_2_STRATEGISTS_RUNNING: { STRATEGISTS_COMPLETED: "ROUND_2_STRATEGISTS_COMPLETED" },
    ROUND_2_STRATEGISTS_COMPLETED: { MERGED: "ROUND_2_MERGED" },
    ROUND_2_MERGED: { START_EVALUATION: "ROUND_2_EVALUATION_RUNNING" },
    ROUND_2_EVALUATION_RUNNING: { EVALUATION_COMPLETED: "ROUND_2_EVALUATION_COMPLETED" },
    ROUND_2_EVALUATION_COMPLETED: { LINGUISTIC_COMPLETED: "ROUND_2_LINGUISTIC_REVIEW_COMPLETED" },
    ROUND_2_LINGUISTIC_REVIEW_COMPLETED: { SYNTHESIS_COMPLETED: "ROUND_2_SYNTHESIS_COMPLETED" },
    ROUND_2_SYNTHESIS_COMPLETED: { OWNER_GATE: "OWNER_CROSS_ROUND_REVIEW_REQUIRED" },
    OWNER_CROSS_ROUND_REVIEW_REQUIRED: {},
  };
  const next = transitions[current][event]; if (!next) throw new Error(`invalid Round 2 lifecycle transition ${current} -> ${event}`); return next;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value.trim();
}
function normalizedName(value: string): string { return value.toLocaleLowerCase("en-US").replace(/[\s\p{P}\p{S}_]+/gu, ""); }
function hasForbiddenReasoning(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const forbidden = new Set(["reasoning", "reasoning_content", "reasoning_details", "chain_of_thought", "scratchpad", "hiddenReasoning"]);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => forbidden.has(key) || hasForbiddenReasoning(child));
}
function setValidation(expected: readonly string[], returned: readonly string[], label: string): void {
  const expectedSet = new Set(expected);
  const returnedSet = new Set(returned);
  if (expectedSet.size !== expected.length) throw new Error(`${label} expected candidate IDs contain duplicates`);
  if (returnedSet.size !== returned.length) throw new Error(`${label} returned candidate IDs contain duplicates`);
  const missing = expected.filter((id) => !returnedSet.has(id));
  const unknown = returned.filter((id) => !expectedSet.has(id));
  if (missing.length || unknown.length) throw new Error(`${label} coverage mismatch: missing=${missing.join(",")} unknown=${unknown.join(",")}`);
}

export function assertRequestedModel(modelKey: Round2ModelKey, requestedModel: string, actualModel?: string | null): ModelRoute {
  const route = NAMING_ROUND2_MODEL_ROUTES[modelKey];
  if (requestedModel !== route.model) throw new Error(`ROUND_2_REQUESTED_MODEL_MISMATCH: expected ${route.model}, got ${requestedModel}`);
  if (actualModel !== undefined && actualModel !== null && actualModel !== route.model) throw new Error(`ROUND_2_ACTUAL_MODEL_MISMATCH: expected ${route.model}, got ${actualModel}`);
  return route;
}

/** Creates the only permissible shared input to both independent strategists. */
export function createIndependentStrategistInput(input: Readonly<{ workflowId: string; correlationId: string; namingBriefArtifactId: string; upstreamArtifactIds: readonly string[]; round1BenchmarkArtifactId: string; modelKey: Round2ModelKey }>): Readonly<Record<string, unknown>> {
  requireText(input.workflowId, "workflowId"); requireText(input.correlationId, "correlationId"); requireText(input.namingBriefArtifactId, "namingBriefArtifactId");
  if (input.upstreamArtifactIds.length === 0) throw new Error("upstreamArtifactIds is required");
  const route = assertRequestedModel(input.modelKey, NAMING_ROUND2_MODEL_ROUTES[input.modelKey].model);
  return Object.freeze({ workflowId: input.workflowId, correlationId: input.correlationId, round: 2, role: input.modelKey === "CLAUDE" ? "NAMING_STRATEGIST_CLAUDE" : "NAMING_STRATEGIST_SOL", route, namingBriefArtifactId: input.namingBriefArtifactId, upstreamArtifactIds: [...input.upstreamArtifactIds], round1BenchmarkArtifactId: input.round1BenchmarkArtifactId, benchmarkNames: [...ROUND1_REFERENCE_NAMES] });
}

export function validateStrategistCandidates(candidates: readonly NamingCandidate[], modelKey: Round2ModelKey): readonly NamingCandidate[] {
  if (candidates.length < NAMING_ROUND2_STRATEGIST_MIN || candidates.length > NAMING_ROUND2_STRATEGIST_MAX) throw new Error(`strategist candidate count must be ${NAMING_ROUND2_STRATEGIST_MIN}-${NAMING_ROUND2_STRATEGIST_MAX}`);
  const expectedModel = NAMING_ROUND2_MODEL_ROUTES[modelKey].model;
  const expectedRole = modelKey === "CLAUDE" ? "NAMING_STRATEGIST_CLAUDE" : "NAMING_STRATEGIST_SOL";
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (hasForbiddenReasoning(candidate)) throw new Error("hidden reasoning is not permitted in naming business artifacts");
    for (const field of ["candidateId", "name", "territory", "oneLineRationale", "strategicConnection", "historicalPillarFit", "fantasyPillarFit", "masterBrandScalability", "knownConcern", "generationAgent", "generationExecutionId", "generationModel"] as const) requireText(candidate[field], `candidate.${field}`);
    if (candidate.generationAgent !== expectedRole || candidate.generationModel !== expectedModel) throw new Error(`candidate provenance mismatch for ${candidate.candidateId}`);
    if (ids.has(candidate.candidateId)) throw new Error(`duplicate candidateId ${candidate.candidateId}`); ids.add(candidate.candidateId);
  }
  return Object.freeze([...candidates]);
}

export function mergeRound2Candidates(claude: readonly NamingCandidate[], sol: readonly NamingCandidate[], round1Names: readonly string[] = ROUND1_REFERENCE_NAMES): Readonly<{ rawClaudeCount: number; rawSolCount: number; rawTotalCount: number; round1CollisionsRemoved: number; crossModelDuplicatesRemoved: number; independentConvergenceNames: readonly string[]; finalUniqueRound2Count: number; candidates: readonly MergedNamingCandidate[] }> {
  validateStrategistCandidates(claude, "CLAUDE"); validateStrategistCandidates(sol, "SOL");
  const prior = new Set(round1Names.map(normalizedName)); const kept = new Map<string, MergedNamingCandidate>();
  let collisions = 0; let duplicates = 0;
  for (const candidate of [...claude, ...sol]) {
    const key = normalizedName(candidate.name);
    if (prior.has(key)) { collisions += 1; continue; }
    const existing = kept.get(key);
    if (existing) { duplicates += 1; kept.set(key, { ...existing, generationModels: Object.freeze([...existing.generationModels, candidate.generationModel]), independentConvergence: true }); continue; }
    kept.set(key, { ...candidate, generationModels: Object.freeze([candidate.generationModel]), independentConvergence: false });
  }
  const candidates = Object.freeze([...kept.values()]); const convergences = Object.freeze(candidates.filter((item) => item.independentConvergence).map((item) => item.name));
  return Object.freeze({ rawClaudeCount: claude.length, rawSolCount: sol.length, rawTotalCount: claude.length + sol.length, round1CollisionsRemoved: collisions, crossModelDuplicatesRemoved: duplicates, independentConvergenceNames: convergences, finalUniqueRound2Count: candidates.length, candidates });
}

/** A converged name is retained but never sent to a model that generated it. */
export function planCrossEvaluationBatches(candidates: readonly MergedNamingCandidate[], parentCandidateSet: string): Readonly<{ batches: readonly EvaluationBatch[]; independentConvergenceReviewRequired: readonly string[] }> {
  requireText(parentCandidateSet, "parentCandidateSet");
  const evaluationCandidates = candidates.filter((candidate) => !candidate.independentConvergence);
  const manual = Object.freeze(candidates.filter((candidate) => candidate.independentConvergence).map((candidate) => candidate.candidateId));
  const groups: Array<[Round2ModelKey, MergedNamingCandidate[]]> = [["CLAUDE", []], ["SOL", []]];
  for (const candidate of evaluationCandidates) {
    const generatedByClaude = candidate.generationModel === NAMING_ROUND2_MODEL_ROUTES.CLAUDE.model;
    groups[generatedByClaude ? 1 : 0][1].push(candidate); // Claude -> Sol; Sol -> Claude
  }
  const batches: EvaluationBatch[] = [];
  for (const [evaluator, group] of groups) for (let offset = 0; offset < group.length; offset += NAMING_ROUND2_BATCH_MAX) {
    const slice = Object.freeze(group.slice(offset, offset + NAMING_ROUND2_BATCH_MAX)); const route = NAMING_ROUND2_MODEL_ROUTES[evaluator];
    if (slice.some((candidate) => candidate.generationModels.includes(route.model))) throw new Error("cross-evaluation may not send a candidate to its generating model");
    batches.push(Object.freeze({ batchId: `round2-evaluation-${evaluator.toLowerCase()}-${batches.length + 1}`, batchIndex: batches.length + 1, evaluatorRole: evaluator === "CLAUDE" ? "BRAND_EVALUATOR_CLAUDE" : "BRAND_EVALUATOR_SOL", evaluatorModel: route.model, parentCandidateSet, expectedCandidateIds: Object.freeze(slice.map((candidate) => candidate.candidateId)), candidates: slice }));
  }
  return Object.freeze({ batches: Object.freeze(batches), independentConvergenceReviewRequired: manual });
}

export function validateEvaluationBatch(batch: EvaluationBatch, output: readonly NamingEvaluation[]): readonly NamingEvaluation[] {
  if (batch.candidates.length > NAMING_ROUND2_BATCH_MAX) throw new Error("evaluation batch exceeds max size");
  if (hasForbiddenReasoning(output)) throw new Error("hidden reasoning is not permitted in evaluation artifacts");
  setValidation(batch.expectedCandidateIds, output.map((item) => item.candidateId), "evaluation");
  for (const item of output) {
    requireText(item.name, "evaluation.name"); requireText(item.primaryStrength, "evaluation.primaryStrength"); requireText(item.primaryConcern, "evaluation.primaryConcern"); requireText(item.benchmarkReason, "evaluation.benchmarkReason");
    if (item.primaryStrength.split(/\s+/).length > 20 || item.primaryConcern.split(/\s+/).length > 20 || item.benchmarkReason.split(/\s+/).length > 25) throw new Error("evaluation compact-field limit exceeded");
    if (!["STRONGER_THAN_ROUND1_REFERENCE", "COMPARABLE_TO_ROUND1_REFERENCE", "WEAKER_THAN_ROUND1_REFERENCE"].includes(item.benchmarkComparison)) throw new Error("invalid benchmark comparison");
    for (const key of Object.keys(weights) as EvaluationScoreKey[]) if (!Number.isFinite(item.scores[key]) || item.scores[key] < 0 || item.scores[key] > 10) throw new Error(`invalid score ${key}`);
    if (item.hardFail && !requireText(item.hardFailReason, "evaluation.hardFailReason")) throw new Error("hard fail requires a reason");
  }
  return Object.freeze([...output]);
}

export function weightedScore(scores: Readonly<Record<EvaluationScoreKey, number>>): number { return Number((Object.entries(weights).reduce((sum, [key, weight]) => sum + scores[key as EvaluationScoreKey] * weight, 0) / 10).toFixed(2)); }

export function planLinguisticBatches(candidates: readonly MergedNamingCandidate[]): readonly LinguisticBatch[] {
  const batches: LinguisticBatch[] = [];
  for (let offset = 0; offset < candidates.length; offset += NAMING_ROUND2_BATCH_MAX) { const slice = Object.freeze(candidates.slice(offset, offset + NAMING_ROUND2_BATCH_MAX)); batches.push(Object.freeze({ batchId: `round2-linguistic-${batches.length + 1}`, batchIndex: batches.length + 1, expectedCandidateIds: Object.freeze(slice.map((candidate) => candidate.candidateId)), candidates: slice })); }
  return Object.freeze(batches);
}
export function validateLinguisticBatch(batch: LinguisticBatch, output: readonly LinguisticReview[]): readonly LinguisticReview[] {
  if (batch.candidates.length > NAMING_ROUND2_BATCH_MAX) throw new Error("linguistic batch exceeds max size"); if (hasForbiddenReasoning(output)) throw new Error("hidden reasoning is not permitted in linguistic artifacts");
  setValidation(batch.expectedCandidateIds, output.map((item) => item.candidateId), "linguistic");
  for (const item of output) { for (const field of ["pronunciationConcern", "spellingConcern", "culturalConcern", "internationalUsability", "semanticAssociation"] as const) requireText(item[field], `linguistic.${field}`); if (item.hardFail) requireText(item.hardFailReason, "linguistic.hardFailReason"); }
  return Object.freeze([...output]);
}

export type ShortlistItem = Readonly<{ name: string; candidateId?: string; sourceRound: 1 | 2; generationModel: string; territory: string; weightedScore: number; benchmarkComparison: BenchmarkComparison; majorStrength: string; majorConcern: string; historicalFit: string; fantasyFit: string; masterBrandFit: string; ownerStatus: "NOT_REVIEWED" }>;
export function validateRound2Synthesis(round2Top10: readonly ShortlistItem[], crossRoundPool: readonly ShortlistItem[]): void {
  if (round2Top10.length > 10) throw new Error("Round 2 shortlist may contain at most 10 names"); if (crossRoundPool.length > 8) throw new Error("cross-round pool may contain at most 8 names");
  for (const item of [...round2Top10, ...crossRoundPool]) { if (item.ownerStatus !== "NOT_REVIEWED") throw new Error("owner status must remain NOT_REVIEWED"); if (!Number.isFinite(item.weightedScore)) throw new Error("shortlist weighted score is required"); if (item.sourceRound === 2 && !item.candidateId) throw new Error("Round 2 shortlist item requires candidateId"); }
}
