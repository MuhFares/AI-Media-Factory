export type VoiceMetadataConfidence = "PROVIDER_RUNTIME" | "OFFICIAL_DOCUMENTATION" | "OFFICIAL_MODEL_DOCUMENTATION" | "PROJECT_VERIFIED" | "UNKNOWN";
export type VoiceProductionStatus = "UNTESTED" | "TECHNICALLY_TESTED" | "HUMAN_APPROVED" | "UNKNOWN";

export interface VoiceEvidenceProvenance {
  sourceType: VoiceMetadataConfidence;
  sourceIdentifier: string;
  provider: string;
  model?: string;
  retrievedAt: string;
}

export interface VoiceCatalogRecord {
  provider: string;
  providerVoiceId: string;
  displayName?: string;
  model?: string;
  language?: string;
  locale?: string;
  gender?: string;
  accent?: string;
  dialect?: string;
  style?: string;
  description?: string;
  recommendedUseCases?: string[];
  isAvailable: "YES" | "NO" | "UNKNOWN";
  isDefault?: boolean;
  automationEligible: boolean;
  productionStatus: VoiceProductionStatus;
  metadataConfidence: VoiceMetadataConfidence;
  evidence: VoiceEvidenceProvenance[];
  evaluation?: { humanNaturalnessScore?: number; pronunciationScore?: number; emotionalFitScore?: number; humanVerdict?: string; testedAt?: string; testArtifactId?: string };
}

export function selectVoice(records: readonly VoiceCatalogRecord[], query: { provider: string; model?: string; language: string; excludeVoiceIds?: readonly string[]; requiredGender?: string }): VoiceCatalogRecord | undefined {
  return records.find((record) => record.provider === query.provider && (query.model === undefined || record.model === query.model) && record.language === query.language && record.isAvailable === "YES" && record.automationEligible && (query.requiredGender === undefined || record.gender === query.requiredGender) && !(query.excludeVoiceIds ?? []).includes(record.providerVoiceId));
}
