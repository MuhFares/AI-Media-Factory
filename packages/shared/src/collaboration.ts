import type { AgentId, Json, Timestamp, Uuid } from "./index.js";

/** Lifecycle state of a cross-agent handoff. */
export type CollaborationStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed" | "cancelled";

/** Stable discriminator for artifacts exchanged by the core agents. */
export type AgentArtifactKind = "execution_plan" | "research_report" | "coding_report" | "review_report" | "qa_report" | "documentation_report";

/** State of the artifact itself, independent from transport/workflow state. */
export type AgentArtifactStatus = "proposed" | "completed" | "blocked" | "failed";

/** Evidence provenance, kept distinct so supplied claims cannot be mistaken for execution. */
export type AgentEvidence =
  | { readonly kind: "runtime"; readonly evidenceId: Uuid; readonly observedAt: Timestamp; readonly source: string; readonly details: string }
  | { readonly kind: "supplied"; readonly evidenceId: Uuid; readonly observedAt: Timestamp; readonly source: string; readonly details: string }
  | { readonly kind: "not_available"; readonly reason: string };

/** Structured failure information attached to a handoff or envelope. */
export interface AgentError {
  readonly code: string;
  readonly category: "validation" | "capability" | "execution" | "dependency" | "unknown";
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Record<string, Json>;
}

/** Metadata shared by all collaboration messages. */
export interface CollaborationMetadata {
  readonly schemaVersion: string;
  readonly createdAt: Timestamp;
  readonly updatedAt?: Timestamp;
  readonly attempt: number;
  readonly traceId: string;
}

/** A structurally typed artifact. The kind and payload type are coupled by the caller. */
export interface AgentArtifact<TKind extends AgentArtifactKind, TPayload extends object> {
  readonly artifactId: Uuid;
  readonly kind: TKind;
  readonly producerAgent: AgentId;
  readonly workflowId: Uuid;
  readonly correlationId: Uuid;
  readonly status: AgentArtifactStatus;
  readonly payload: TPayload;
  readonly contentType: "application/json";
  readonly schemaVersion: string;
  readonly createdAt: Timestamp;
  readonly parentArtifact?: { readonly artifactId: Uuid; readonly kind: AgentArtifactKind };
}

interface AgentHandoffBase<TKind extends AgentArtifactKind, TPayload extends object> {
  readonly workflowId: Uuid;
  readonly correlationId: Uuid;
  readonly sourceAgent: AgentId;
  readonly targetAgent: AgentId;
  readonly objective: string;
  readonly evidence: readonly AgentEvidence[];
  readonly errors: readonly AgentError[];
  readonly previousArtifactId?: Uuid;
  readonly metadata: CollaborationMetadata;
}

/** Successful/in-flight artifacts are the only artifacts accepted as successful upstream output. */
export type SuccessfulAgentHandoff<TKind extends AgentArtifactKind, TPayload extends object> = AgentHandoffBase<TKind, TPayload> & {
  readonly status: "pending" | "in_progress" | "completed";
  readonly artifact: AgentArtifact<TKind, TPayload> & { readonly status: "proposed" | "completed" };
};

/** Blocked/failed artifacts remain typed failures and cannot be represented as successful handoffs. */
export type UnsuccessfulAgentHandoff<TKind extends AgentArtifactKind, TPayload extends object> = AgentHandoffBase<TKind, TPayload> & {
  readonly status: "blocked" | "failed" | "cancelled";
  readonly artifact: AgentArtifact<TKind, TPayload> & { readonly status: "blocked" | "failed" };
};

export type AgentHandoff<TKind extends AgentArtifactKind, TPayload extends object> = SuccessfulAgentHandoff<TKind, TPayload> | UnsuccessfulAgentHandoff<TKind, TPayload>;

/** Top-level in-memory envelope; it carries no persistence or transport semantics. */
export interface CollaborationEnvelope<TKind extends AgentArtifactKind, TPayload extends object> {
  readonly envelopeId: Uuid;
  readonly handoff: AgentHandoff<TKind, TPayload>;
  readonly metadata: CollaborationMetadata;
}
