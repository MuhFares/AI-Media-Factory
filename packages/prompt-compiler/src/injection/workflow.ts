/**
 * Workflow Context Injection (Req #10).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Injects the current workflow context (brand, correlation, step outputs, data)
 * into the prompt so the agent knows where it is in the workflow.
 */

import type { WorkflowContext } from "../../workflow-engine/src/model/context";

export interface WorkflowContextInjector {
  /** Inject workflow context into the prompt. */
  inject(context: WorkflowContext, options?: WorkflowInjectionOptions): Promise<string>;
}

export interface WorkflowInjectionOptions {
  /** Include full step history? */
  includeHistory?: boolean;
  /** Include only current step's relevant context? */
  currentOnly?: boolean;
  maxTokens?: number;
}

export interface WorkflowContextInjectionResult {
  content: string;
  tokens: number;
  truncated: boolean;
}