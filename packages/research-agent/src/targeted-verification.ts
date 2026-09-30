import type { Json } from "@ai-media-factory/shared";
import { buildVerificationQueryFor } from "./research-agent.js";

export const TARGETED_VERIFICATION_MODE = "TARGETED_VERIFICATION" as const;

export interface TargetedVerificationDispatchInput {
  readonly mode: typeof TARGETED_VERIFICATION_MODE;
  readonly projectId: string;
  readonly workflowId: string;
  readonly artifactId: string;
  readonly selectedCandidateIds: readonly string[];
  readonly verificationObjectives?: Readonly<Record<string, string>>;
  readonly maxVerificationRetrievalCalls: number;
  readonly maxReevaluationTextCalls: number;
}

export interface TargetedVerificationPlanEntry {
  readonly candidateId: string;
  readonly role: "TARGETED_VERIFICATION";
  readonly retrievalId: string;
  readonly purpose: string;
  readonly claims: readonly string[];
  readonly query: string;
  readonly capabilityId: "web.search";
}

type RecordLike = Record<string, unknown>;
const record = (value: unknown): RecordLike => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : {};

/** Provider-free, deterministic plan from existing candidate semantics only. */
export function buildTargetedVerificationPlan(
  artifactPayload: unknown,
  input: TargetedVerificationDispatchInput,
): TargetedVerificationPlanEntry[] {
  if (input.mode !== TARGETED_VERIFICATION_MODE) throw new Error("TARGETED_VERIFICATION_MODE_REQUIRED");
  if (!Number.isSafeInteger(input.maxVerificationRetrievalCalls) || input.maxVerificationRetrievalCalls < 1) throw new Error("TARGETED_VERIFICATION_RETRIEVAL_LIMIT_INVALID");
  if (input.maxVerificationRetrievalCalls < input.selectedCandidateIds.length) throw new Error("TARGETED_VERIFICATION_RETRIEVAL_ENVELOPE_TOO_SMALL");
  if (input.maxReevaluationTextCalls !== 1) throw new Error("TARGETED_VERIFICATION_REEVALUATION_LIMIT_MUST_EQUAL_ONE");
  const payload = record(artifactPayload);
  const candidates = Array.isArray(payload.candidateStories) ? payload.candidateStories.map(record) : [];
  const byId = new Map(candidates.map((candidate) => [String(candidate.candidateId ?? ""), candidate]));
  const selected = [...new Set(input.selectedCandidateIds)];
  if (selected.length === 0 || selected.length !== input.selectedCandidateIds.length) throw new Error("TARGETED_VERIFICATION_CANDIDATE_SELECTION_INVALID");
  for (const key of Object.keys(input.verificationObjectives ?? {})) {
    if (!selected.includes(key)) throw new Error(`TARGETED_VERIFICATION_OBJECTIVE_CANDIDATE_INVALID:${key}`);
  }
  if (selected.length > input.maxVerificationRetrievalCalls) throw new Error("TARGETED_VERIFICATION_RETRIEVAL_LIMIT_EXCEEDED");
  return selected.map((candidateId, index) => {
    const candidate = byId.get(candidateId);
    if (!candidate) throw new Error(`TARGETED_VERIFICATION_UNKNOWN_CANDIDATE:${candidateId}`);
    if (["SUPERSEDED", "REJECTED"].includes(String(candidate.lifecycleStatus ?? "").toUpperCase())) throw new Error(`TARGETED_VERIFICATION_CANDIDATE_TERMINAL:${candidateId}`);
    const topic = typeof candidate.topic === "string" ? candidate.topic.trim() : "";
    if (!topic) throw new Error(`TARGETED_VERIFICATION_CANDIDATE_TOPIC_MISSING:${candidateId}`);
    const claims = Array.isArray(candidate.keyClaims) ? candidate.keyClaims.filter((claim): claim is string => typeof claim === "string" && claim.trim() !== "") : [];
    const factualAngle = typeof candidate.factualAngle === "string" && candidate.factualAngle.trim() !== "" ? candidate.factualAngle.trim() : null;
    const boundedClaims = [...claims, ...(factualAngle === null ? [] : [factualAngle])].slice(0, 5);
    if (boundedClaims.length === 0) throw new Error(`TARGETED_VERIFICATION_CANDIDATE_CLAIMS_MISSING:${candidateId}`);
    return {
      candidateId,
      role: "TARGETED_VERIFICATION",
      retrievalId: `targeted-verify-${candidateId}-${index + 1}`,
      purpose: typeof input.verificationObjectives?.[candidateId] === "string" && input.verificationObjectives[candidateId]!.trim() !== ""
        ? `Corroborate only the existing factual claims for ${topic}: ${input.verificationObjectives[candidateId]!.trim()}`
        : `Corroborate only the existing factual claims for ${topic}`,
      claims: boundedClaims,
      query: buildVerificationQueryFor(`${topic} ${boundedClaims[0]}`),
      capabilityId: "web.search",
    };
  });
}

export interface TargetedCandidateReevaluation {
  readonly candidateId: string;
  readonly factualVerification: { readonly status: "STRONG" | "PARTIAL" | "INCOMPLETE"; readonly basis: string };
  readonly recommendedForProduction: boolean;
  readonly supportingSourceUrls: readonly string[];
  readonly evidenceRisks: readonly string[];
}

/** Strictly validate that reevaluation updates only selected existing candidates. */
export function validateTargetedReevaluation(
  output: Json,
  artifactPayload: unknown,
  selectedCandidateIds: readonly string[],
): TargetedCandidateReevaluation[] {
  const value = record(output);
  const updates = Array.isArray(value.candidateUpdates) ? value.candidateUpdates.map(record) : [];
  if (updates.length !== selectedCandidateIds.length) throw new Error("TARGETED_REEVALUATION_CANDIDATE_COUNT_MISMATCH");
  const existing = new Set((Array.isArray(record(artifactPayload).candidateStories) ? record(artifactPayload).candidateStories as unknown[] : []).map((item) => String(record(item).candidateId ?? "")));
  const selected = new Set(selectedCandidateIds);
  const seen = new Set<string>();
  return updates.map((update) => {
    const candidateId = typeof update.candidateId === "string" ? update.candidateId : "";
    if (!existing.has(candidateId) || !selected.has(candidateId) || seen.has(candidateId)) throw new Error(`TARGETED_REEVALUATION_CANDIDATE_ID_INVALID:${candidateId}`);
    seen.add(candidateId);
    if ("topic" in update || "factualAngle" in update || "keyClaims" in update) throw new Error("TARGETED_REEVALUATION_SEMANTIC_REWRITE_FORBIDDEN");
    const factual = record(update.factualVerification);
    if (!["STRONG", "PARTIAL", "INCOMPLETE"].includes(String(factual.status)) || typeof factual.basis !== "string" || factual.basis.trim() === "") throw new Error(`TARGETED_REEVALUATION_FACTUAL_STATUS_INVALID:${candidateId}`);
    if (typeof update.recommendedForProduction !== "boolean") throw new Error(`TARGETED_REEVALUATION_RECOMMENDATION_INVALID:${candidateId}`);
    const supportingSourceUrls = Array.isArray(update.supportingSourceUrls) ? update.supportingSourceUrls.filter((url): url is string => typeof url === "string" && url.trim() !== "") : [];
    const evidenceRisks = Array.isArray(update.evidenceRisks) ? update.evidenceRisks.filter((risk): risk is string => typeof risk === "string") : [];
    return {
      candidateId,
      factualVerification: { status: factual.status as "STRONG" | "PARTIAL" | "INCOMPLETE", basis: factual.basis },
      recommendedForProduction: update.recommendedForProduction === true && factual.status === "STRONG",
      supportingSourceUrls,
      evidenceRisks,
    };
  });
}
