import { createHash } from "node:crypto";

export type ModelAvailabilityState = "CONFIGURED" | "CATALOG_AVAILABLE" | "STALE" | "UNKNOWN_LIVE_HEALTH" | "UNAVAILABLE";
export type StructuredOutputStrategy = "NONE" | "NATIVE_SCHEMA" | "JSON_MODE" | "PROMPT_JSON";
export type CanonicalProtocol = "OPENAI_COMPATIBLE" | "ANTHROPIC";

export interface CanonicalRouteResolution {
  readonly routingVersionId: string;
  readonly routingScope: "GLOBAL_DEFAULT" | "PROJECT";
  readonly projectId: string | null;
  readonly profile: string;
  readonly role: string;
  readonly slot: "primary" | "fallback" | "economy" | "premiumEscalation";
  readonly provider: string;
  readonly requestedModel: string;
  readonly resolvedModel: string;
  readonly model: string;
  readonly priceSnapshotId: string;
  readonly fallbackUsed: boolean;
  readonly fallbackReason: string | null;
}

export interface ModelCatalogEvidence {
  readonly provider: string;
  readonly model: string;
  readonly availability: string;
  readonly retrievedAt: string | null;
  readonly contextLength: number | null;
  readonly maxOutputTokens: number | null;
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
  readonly supportedParameters: readonly string[];
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly currentPriceSnapshotId: string | null;
  readonly priceSnapshotRetrievedAt: string | null;
  readonly capabilityHash: string | null;
  readonly protocol?: CanonicalProtocol | null;
}

export interface LlmPreflightRequest {
  readonly executionType: "LLM" | "HYBRID" | "DETERMINISTIC" | "CAPABILITY" | "OWNER_GATE";
  readonly prompt: string;
  readonly expectedOutputTokens: number;
  readonly structuredOutput: StructuredOutputStrategy;
  readonly allowPromptJson?: boolean;
  readonly requiredInputModality?: string;
  readonly requiredOutputModality?: string;
  readonly requiredProtocol?: CanonicalProtocol;
  readonly requiresTools?: boolean;
  readonly executionEnvironmentAllowed: boolean;
  readonly now?: string;
  readonly maxCatalogAgeMs?: number;
  readonly maxPriceAgeMs?: number;
  readonly expectedFingerprint?: string;
}

export interface LlmPreflightResult {
  readonly ok: boolean;
  readonly code: "PREFLIGHT_PASS" | string;
  readonly failureCodes: readonly string[];
  readonly availabilityState: ModelAvailabilityState;
  readonly liveHealthState: "UNKNOWN_LIVE_HEALTH";
  readonly estimatedInputTokens: number;
  readonly expectedOutputTokens: number;
  readonly contextLength: number | null;
  readonly configurationFingerprint: string;
  readonly provenance: CanonicalRouteResolution;
}

const DEFAULT_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1_000;
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const fingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const age = (value: string | null, now: number): number => value === null || !Number.isFinite(Date.parse(value)) ? Number.POSITIVE_INFINITY : Math.max(0, now - Date.parse(value));
const declared = (value: unknown): boolean => value === true || value === "DECLARED";

/** Conservative local estimate: UTF-8/prose frequently exceeds four chars/token. */
export function estimatePromptTokens(prompt: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(prompt, "utf8") / 3));
}

export function evaluateLlmPreflight(route: CanonicalRouteResolution, catalog: ModelCatalogEvidence, request: LlmPreflightRequest): LlmPreflightResult {
  const failures: string[] = [];
  const now = Date.parse(request.now ?? new Date().toISOString());
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const catalogAge = age(catalog.retrievedAt, nowMs);
  const priceAge = age(catalog.priceSnapshotRetrievedAt, nowMs);
  const catalogFresh = catalogAge <= (request.maxCatalogAgeMs ?? DEFAULT_FRESHNESS_MS);
  const priceFresh = priceAge <= (request.maxPriceAgeMs ?? DEFAULT_FRESHNESS_MS);
  const availabilityState: ModelAvailabilityState = catalog.availability !== "AVAILABLE"
    ? "UNAVAILABLE"
    : !catalogFresh ? "STALE" : "CATALOG_AVAILABLE";
  if (!request.executionEnvironmentAllowed) failures.push("EXECUTION_ENVIRONMENT_NOT_ALLOWED");
  if (!(["LLM", "HYBRID"] as const).includes(request.executionType as "LLM" | "HYBRID")) failures.push("ROLE_EXECUTION_TYPE_INCOMPATIBLE");
  if (route.provider !== catalog.provider) failures.push("PROVIDER_MODEL_MISMATCH");
  if (request.requiredProtocol && catalog.protocol !== request.requiredProtocol) failures.push("PROVIDER_PROTOCOL_INCOMPATIBLE");
  if (availabilityState === "UNAVAILABLE") failures.push("MODEL_UNAVAILABLE");
  if (availabilityState === "STALE") failures.push("MODEL_AVAILABILITY_STALE");
  if (route.priceSnapshotId !== catalog.currentPriceSnapshotId) failures.push("ROUTING_PRICE_SNAPSHOT_STALE");
  if (!priceFresh) failures.push("PRICE_SNAPSHOT_STALE");
  const inputTokens = estimatePromptTokens(request.prompt);
  if (catalog.contextLength === null || catalog.contextLength <= 0) failures.push("MODEL_CONTEXT_LIMIT_UNKNOWN");
  else if (inputTokens + request.expectedOutputTokens > catalog.contextLength) failures.push("MODEL_CONTEXT_OVERFLOW");
  if (catalog.maxOutputTokens !== null && request.expectedOutputTokens > catalog.maxOutputTokens) failures.push("MODEL_OUTPUT_BUDGET_UNSUPPORTED");
  const parameters = new Set(catalog.supportedParameters);
  const capabilities = record(catalog.capabilities);
  const structuredDeclared = declared(capabilities.structuredOutput) || parameters.has("structured_outputs") || parameters.has("response_format") || parameters.has("json_schema");
  if (request.structuredOutput === "NATIVE_SCHEMA" && !(parameters.has("json_schema") || parameters.has("structured_outputs"))) failures.push("STRUCTURED_OUTPUT_INCOMPATIBLE");
  if (request.structuredOutput === "JSON_MODE" && !structuredDeclared) failures.push("STRUCTURED_OUTPUT_INCOMPATIBLE");
  if (request.structuredOutput === "PROMPT_JSON" && request.allowPromptJson !== true) failures.push("STRUCTURED_OUTPUT_INCOMPATIBLE");
  if (request.requiresTools && !(declared(capabilities.toolCalling) || parameters.has("tools") || parameters.has("tool_choice"))) failures.push("TOOL_CAPABILITY_UNSUPPORTED");
  if (request.requiredInputModality && !catalog.inputModalities.includes(request.requiredInputModality)) failures.push("INPUT_MODALITY_UNSUPPORTED");
  if (request.requiredOutputModality && !catalog.outputModalities.includes(request.requiredOutputModality)) failures.push("OUTPUT_MODALITY_UNSUPPORTED");
  const configurationFingerprint = fingerprint({ route, catalog: { provider: catalog.provider, model: catalog.model, protocol: catalog.protocol ?? null, retrievedAt: catalog.retrievedAt, currentPriceSnapshotId: catalog.currentPriceSnapshotId, priceSnapshotRetrievedAt: catalog.priceSnapshotRetrievedAt, capabilityHash: catalog.capabilityHash, contextLength: catalog.contextLength }, request: { executionType: request.executionType, expectedOutputTokens: request.expectedOutputTokens, structuredOutput: request.structuredOutput, requiredProtocol: request.requiredProtocol ?? null, requiredInputModality: request.requiredInputModality ?? null, requiredOutputModality: request.requiredOutputModality ?? null, requiresTools: request.requiresTools ?? false, executionEnvironmentAllowed: request.executionEnvironmentAllowed } });
  if (request.expectedFingerprint && request.expectedFingerprint !== configurationFingerprint) failures.push("ROUTING_CONFIGURATION_DRIFT");
  return { ok: failures.length === 0, code: failures[0] ?? "PREFLIGHT_PASS", failureCodes: failures, availabilityState, liveHealthState: "UNKNOWN_LIVE_HEALTH", estimatedInputTokens: inputTokens, expectedOutputTokens: request.expectedOutputTokens, contextLength: catalog.contextLength, configurationFingerprint, provenance: route };
}

export interface RetrievalPreflightInput {
  readonly capabilityId: string;
  readonly registeredCapabilityIds: readonly string[];
  readonly lane: string;
  readonly supportedLanes: readonly string[];
  readonly provider: string | null;
  readonly query: string;
  readonly maxQueryLength: number;
  readonly semanticPackingCompleted: boolean;
  readonly mandatorySemanticsPreserved: boolean;
  readonly reservationIdentity: string | null;
  readonly callLeg: string | null;
}
export function retrievalPreflight(input: RetrievalPreflightInput) {
  const failures: string[] = [];
  if (!input.registeredCapabilityIds.includes(input.capabilityId)) failures.push("CAPABILITY_UNAVAILABLE");
  if (!input.supportedLanes.includes(input.lane)) failures.push("RETRIEVAL_LANE_UNSUPPORTED");
  if (!input.provider) failures.push("RETRIEVAL_PROVIDER_UNRESOLVED");
  if (!input.semanticPackingCompleted) failures.push("SEMANTIC_PACKING_REQUIRED");
  if (!input.mandatorySemanticsPreserved) failures.push("MANDATORY_SEMANTICS_MISSING");
  if (input.query.length > input.maxQueryLength || Buffer.byteLength(input.query, "utf8") > input.maxQueryLength) failures.push("QUERY_LENGTH_EXCEEDED");
  if (!input.reservationIdentity || !input.callLeg) failures.push("RETRIEVAL_ACCOUNTING_IDENTITY_INVALID");
  return { ok: failures.length === 0, code: failures[0] ?? "PREFLIGHT_PASS", failureCodes: failures, queryLength: input.query.length, queryBytes: Buffer.byteLength(input.query, "utf8") } as const;
}

export interface PublicationPreflightInput {
  readonly projectId: string;
  readonly channelProjectId: string;
  readonly channelStatus: string;
  readonly channelId: string | null;
  readonly externalChannelId: string | null;
  readonly bindingProjectId: string;
  readonly bindingChannelId: string | null;
  readonly bindingStatus: string;
  /** KNOWN_INVALID/UNKNOWN remain explicit legacy read compatibility only. */
  readonly tokenState: "VALID" | "EXPIRED" | "REVOKED" | "UNKNOWN_REQUIRES_REFRESH" | "KNOWN_INVALID" | "UNKNOWN";
  readonly visibility: string;
  readonly supportedVisibilities: readonly string[];
  readonly title: string;
  readonly description: string;
  readonly titleLimit: number;
  readonly descriptionLimit: number;
  readonly publicationIdentity: string | null;
}
export function publicationPreflight(input: PublicationPreflightInput) {
  const failures: string[] = [];
  if (!input.channelId || !input.externalChannelId) failures.push("PUBLICATION_CHANNEL_IDENTITY_MISSING");
  if (input.channelProjectId !== input.projectId || input.bindingProjectId !== input.projectId) failures.push("PUBLICATION_PROJECT_OWNERSHIP_MISMATCH");
  if (input.bindingChannelId && input.bindingChannelId !== input.channelId) failures.push("PUBLICATION_BINDING_CHANNEL_MISMATCH");
  if (input.channelStatus !== "VERIFIED") failures.push("PUBLICATION_CHANNEL_NOT_VERIFIED");
  if (input.bindingStatus !== "ACTIVE") failures.push("PUBLICATION_CREDENTIAL_BINDING_INACTIVE");
  if (input.tokenState === "KNOWN_INVALID" || input.tokenState === "EXPIRED" || input.tokenState === "REVOKED") failures.push("PUBLICATION_TOKEN_INVALID");
  if (input.tokenState === "UNKNOWN" || input.tokenState === "UNKNOWN_REQUIRES_REFRESH") failures.push("TOKEN_LIVENESS_UNKNOWN_REQUIRES_REFRESH");
  if (!input.supportedVisibilities.includes(input.visibility)) failures.push("PUBLICATION_VISIBILITY_UNSUPPORTED");
  if (input.title.length > input.titleLimit) failures.push("PUBLICATION_TITLE_TOO_LONG");
  if (input.description.length > input.descriptionLimit) failures.push("PUBLICATION_DESCRIPTION_TOO_LONG");
  if (!input.publicationIdentity) failures.push("PUBLICATION_IDENTITY_REQUIRED");
  return { ok: failures.length === 0, code: failures[0] ?? "PREFLIGHT_PASS", failureCodes: failures, tokenLiveness: input.tokenState } as const;
}

export interface AnalyticsPreflightInput {
  readonly projectId: string;
  readonly publicationProjectId: string;
  readonly publicationIdentity: string | null;
  readonly channelId: string | null;
  readonly externalVideoId: string | null;
  readonly providerRoute: string | null;
  readonly artifactWorkflowId: string;
  readonly publicationWorkflowId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
}
export function analyticsPreflight(input: AnalyticsPreflightInput) {
  const failures: string[] = [];
  if (input.projectId !== input.publicationProjectId) failures.push("ANALYTICS_PROJECT_LINKAGE_INVALID");
  if (!input.publicationIdentity || !input.channelId || !input.externalVideoId) failures.push("ANALYTICS_PUBLICATION_IDENTITY_INVALID");
  if (!input.providerRoute) failures.push("ANALYTICS_PROVIDER_ROUTE_INVALID");
  if (input.artifactWorkflowId !== input.publicationWorkflowId) failures.push("ANALYTICS_WORKFLOW_LINKAGE_INVALID");
  const start = Date.parse(input.windowStart), end = Date.parse(input.windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) failures.push("ANALYTICS_MEASUREMENT_WINDOW_INVALID");
  return { ok: failures.length === 0, code: failures[0] ?? "PREFLIGHT_PASS", failureCodes: failures } as const;
}
