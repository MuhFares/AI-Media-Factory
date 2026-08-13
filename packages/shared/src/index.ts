/** Shared types and utilities for AI Media Factory. */

export type MediaKind = "image" | "audio" | "video";

export type JobStatus = "pending" | "processing" | "done" | "failed";

export interface MediaJob {
  id: string;
  kind: MediaKind;
  status: JobStatus;
}

/**
 * Primitive types shared across all packages.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

/** A universally unique id (uuid v4). */
export type Uuid = string;

/** ISO-8601 UTC timestamp. */
export type Timestamp = string;

/** Stable identifier of any agent. */
export type AgentId = string;

/** The event `type` field from the shared envelope. */
export type EventType = string;

/** Step identifier. */
export type StepId = string;

/** JSON value (payloads and memory bodies are arbitrary JSON). */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** Return a friendly greeting used across apps. */
export function greet(name: string): string {
  return `Hello from ${name}!`;
}

export type {
  CollaborationStatus,
  AgentArtifactKind,
  AgentArtifactStatus,
  ExecutionPlanArtifactPayload,
  ResearchReportArtifactPayload,
  CodingReportArtifactPayload,
  ReviewReportArtifactPayload,
  QAReportArtifactPayload,
DocumentationReportArtifactPayload,
  AnalyticsReportArtifactPayload,
  GrowthReportArtifactPayload,
  AgentArtifactPayloadByKind,
  AgentEvidence,
  AgentError,
  CollaborationMetadata,
  AgentArtifact,
  CollaborationArtifact,
  AgentHandoff,
  CollaborationEnvelope,
} from "./collaboration.js";

/**
 * Canonical Workflow Context shared between Runtime and Workflow Engine.
 * This is the single source of truth for workflow execution context.
 */

export interface WorkflowContext {
  workflowId: Uuid;
  correlationId: string | null;
  brandId: string | null;
  /** Accumulated outputs of completed steps, keyed by step id. */
  outputs: Record<string, Json>;
  /** Free-form working data set by branch predicates and steps. */
  data: Record<string, Json>;
}

/** Agent step definition for the executor port. */
export interface AgentStep {
  id: string;
  kind: "agent";
  agent: string;
  emits: string;
  next?: string | string[];
  timeoutSeconds?: number;
  maxAttempts?: number;
  compensatedBy?: string;
}

/** Outcome of executing a single step. */
export interface StepOutcome {
  status: "completed" | "failed" | "awaiting_approval";
  output: Json;
  artifact?: import("./collaboration.js").CollaborationArtifact;
  chosenNext?: string;
  error?: { message: string; retryable: boolean };
}

/**
 * Port for executing a single agent step.
 * The Workflow Engine depends on this port; the Runtime provides the implementation.
 */
export interface AgentExecutorPort {
  executeAgentStep(step: AgentStep, context: WorkflowContext): Promise<StepOutcome>;
}
