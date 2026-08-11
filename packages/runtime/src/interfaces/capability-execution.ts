/** Injectable capability execution boundary exposed by the runtime. */

import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResult,
} from "@ai-media-factory/tool-framework";

export interface CapabilityExecutionPort {
  executeCapability(request: CapabilityRequest): Promise<CapabilityResult>;
}

export type { CapabilityExecutorPort, CapabilityRequest, CapabilityResult } from "@ai-media-factory/tool-framework";
