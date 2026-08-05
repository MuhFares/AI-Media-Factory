/**
 * The event envelope and event I/O contracts.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Mirrors the shared envelope defined in docs/architecture/event-bus.md and
 * the Agent Contract System. The runtime never invents its own envelope.
 */

import type { AgentId, EventType, Json, Timestamp, Uuid } from "./common.js";

/** The shared event envelope every message on the bus conforms to. */
export interface RuntimeEvent {
  schema_version: "1.0.0";
  event_id: Uuid;
  workflow_id: Uuid;
  correlation_id: string | null;
  brand_id: string | null;
  asset_id: string | null;
  timestamp: Timestamp;
  type: EventType;
  source_agent: AgentId;
  target_agent: AgentId;
  payload: Json;
  metadata: EventMetadata;
}

/** Cost/model/trace annotations carried on every event. */
export interface EventMetadata {
  cost_usd?: number;
  model?: string;
  latency_ms?: number;
  trace_id?: string;
  parent_span_id?: string;
}

/** Receives input events destined for an agent from the bus. */
export interface EventConsumer {
  /** Deliver the next input event for the given agent, or null when none. */
  receive(agent: AgentId): Promise<RuntimeEvent | null>;
  /** Acknowledge successful processing (at-least-once delivery). */
  ack(eventId: Uuid): Promise<void>;
  /** Signal a processing failure so the bus can retry or dead-letter. */
  nack(eventId: Uuid, reason: string): Promise<void>;
}

/** Publishes the output event produced by an agent turn. */
export interface EventEmitter {
  /** Publish a validated output event to the bus. */
  emit(event: RuntimeEvent): Promise<void>;
}
