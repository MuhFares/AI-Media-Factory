/**
 * Default WorkflowEventBridge implementation.
 */

import type { Json, Uuid, InboundEventType, OutboundEventType, WorkflowEventBridge } from "../integration/events.js";

type Handler = (event: Json) => Promise<void>;

export class DefaultWorkflowEventBridge implements WorkflowEventBridge {
  private inboundHandlers = new Map<InboundEventType, Handler[]>();
  private outboundEmit: (type: OutboundEventType, workflowId: Uuid, payload: Json) => Promise<void>;

  constructor(
    emit: (type: OutboundEventType, workflowId: Uuid, payload: Json) => Promise<void>
  ) {
    this.outboundEmit = emit;
  }

  onInbound(type: InboundEventType, handler: Handler): void {
    const handlers = this.inboundHandlers.get(type) ?? [];
    handlers.push(handler);
    this.inboundHandlers.set(type, handlers);
  }

  async emit(type: OutboundEventType, workflowId: Uuid, payload: Json): Promise<void> {
    await this.outboundEmit(type, workflowId, payload);
  }

  async dispatchInbound(type: InboundEventType, event: Json): Promise<void> {
    const handlers = this.inboundHandlers.get(type) ?? [];
    await Promise.all(handlers.map((h) => h(event)));
  }
}