import type { AgentId, Json, Timestamp, Uuid } from "./index.js";

/** Lifecycle state of a cross-agent handoff. */
export type CollaborationStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed" | "cancelled";

/** Stable discriminator for artifacts exchanged by the core agents. */
export type AgentArtifactKind = "execution_plan" | "research_report" | "coding_report" | "review_report" | "qa_report" | "documentation_report";

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

/** A typed artifact carrying one agent's structured output. */
export interface AgentArtifact<TPayload = Record<string, Json>> {
  readonly artifactId: Uuid;
  readonly kind: AgentArtifactKind;
  readonly payload: TPayload;
  readonly contentType: "application/json";
  readonly schemaVersion: string;
  readonly createdAt: Timestamp;
  readonly parentArtifactId?: Uuid;
}

/** A directed transfer of an artifact between agents. */
export interface AgentHandoff<TPayload = Record<string, Json>> {
  readonly workflowId: Uuid;
  readonly correlationId: Uuid;
  readonly sourceAgent: AgentId;
  readonly targetAgent: AgentId;
  readonly objective: string;
  readonly status: CollaborationStatus;
  readonly artifact: AgentArtifact<TPayload>;
  readonly evidence: readonly AgentEvidence[];
  readonly errors: readonly AgentError[];
  readonly previousArtifactId?: Uuid;
  readonly metadata: CollaborationMetadata;
}

/** Top-level envelope used by workflow coordination transports. */
export interface CollaborationEnvelope<TPayload = Record<string, Json>> {
  readonly envelopeId: Uuid;
  readonly handoff: AgentHandoff<TPayload>;
  readonly metadata: CollaborationMetadata;
}
