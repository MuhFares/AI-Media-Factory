import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { RuntimeCapabilityExecutor } from "../dist/index.js";
import {
  createCapabilityRegistry,
  DefaultCapabilityRegistry,
} from "@ai-media-factory/tool-framework";

const FILESYSTEM = "filesystem";
const COMMAND = "execution.command";
const WEB_SEARCH = "web.search";

function descriptor(capabilityId) {
  return {
    capabilityId,
    description: `Capability ${capabilityId}`,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
  };
}

function registryWithPolicy() {
  return createCapabilityRegistry({
    capabilities: [descriptor(FILESYSTEM), descriptor(COMMAND), descriptor(WEB_SEARCH)],
    grants: [
      { agentId: "research", capabilityIds: [WEB_SEARCH] },
      { agentId: "coding", capabilityIds: [FILESYSTEM, COMMAND] },
      { agentId: "qa", capabilityIds: [COMMAND] },
    ],
  });
}

function request(capabilityId, agentId) {
  return {
    requestId: `request-${capabilityId}-${agentId}`,
    capabilityId,
    agentId,
    workflowId: "workflow-1",
    correlationId: "correlation-1",
    input: {},
    requestedAt: "2026-08-11T00:00:00.000Z",
  };
}

function successExecutor(request) {
  return {
    execute: async (value) => ({
      status: "success",
      resultId: `result-${value.requestId}`,
      capabilityId: value.capabilityId,
      output: { executed: true },
      evidence: {
        evidenceId: `evidence-${value.requestId}`,
        capabilityId: value.capabilityId,
        agentId: value.agentId,
        workflowId: value.workflowId,
        correlationId: value.correlationId,
        executedAt: "2026-08-11T00:00:01.000Z",
        durationMs: 1,
        succeeded: true,
      },
    }),
  };
}

describe("capability registry + runtime boundary integration", () => {
  it("RuntimeCapabilityExecutor authorizes through the registry/resolver and returns valid evidence", async () => {
    const registry = registryWithPolicy();
    const boundary = new RuntimeCapabilityExecutor({ resolver: registry, executor: successExecutor() });

    const result = await boundary.executeCapability(request(WEB_SEARCH, "research"));
    strictEqual(result.status, "success");
    strictEqual(result.capabilityId, WEB_SEARCH);
    strictEqual(result.evidence.agentId, "research");
    strictEqual(result.evidence.workflowId, "workflow-1");
    strictEqual(result.evidence.correlationId, "correlation-1");
    strictEqual(result.evidence.succeeded, true);
  });

  it("authorization failure returns blocked without invoking the executor", async () => {
    const registry = registryWithPolicy();
    let invoked = false;
    const executor = {
      execute: async () => {
        invoked = true;
        return { status: "success", resultId: "unexpected", capabilityId: COMMAND, output: {} };
      },
    };
    const boundary = new RuntimeCapabilityExecutor({ resolver: registry, executor });

    // qa is not granted FILESYSTEM.
    const denied = await boundary.executeCapability(request(FILESYSTEM, "qa"));
    strictEqual(denied.status, "blocked");
    strictEqual(invoked, false);
  });

  it("unknown capability and unknown agent are both denied", async () => {
    const registry = registryWithPolicy();
    const boundary = new RuntimeCapabilityExecutor({ resolver: registry, executor: successExecutor() });

    const unknownCapability = await boundary.executeCapability(request("image.generation", "coding"));
    strictEqual(unknownCapability.status, "blocked");
    strictEqual(unknownCapability.reason, "Unknown capability");

    const unknownAgent = await boundary.executeCapability(request(COMMAND, "ceo"));
    strictEqual(unknownAgent.status, "blocked");
    strictEqual(unknownAgent.reason, "Capability is not authorized for this agent");
  });

  it("registers with DefaultCapabilityRegistry and routes a granted pair", async () => {
    const registry = new DefaultCapabilityRegistry();
    registry.register(descriptor(FILESYSTEM));
    registry.getAuthorizationPolicy().grant("coding", FILESYSTEM);

    const boundary = new RuntimeCapabilityExecutor({ resolver: registry, executor: successExecutor() });
    const result = await boundary.executeCapability(request(FILESYSTEM, "coding"));
    strictEqual(result.status, "success");
    strictEqual(result.evidence.capabilityId, FILESYSTEM);

    const denied = await boundary.executeCapability(request(FILESYSTEM, "research"));
    strictEqual(denied.status, "blocked");
  });

  it("explicit grant matrix covers all current agent/capability pairs", () => {
    const registry = registryWithPolicy();
    ok(registry.isAuthorized("research", WEB_SEARCH));
    ok(registry.isAuthorized("coding", FILESYSTEM));
    ok(registry.isAuthorized("coding", COMMAND));
    ok(registry.isAuthorized("qa", COMMAND));
    // CEO/Orchestrator are not executable agents and hold no grants.
    deepStrictEqual(registry.getAuthorizationPolicy().grantsFor("ceo"), []);
    deepStrictEqual(registry.getAuthorizationPolicy().grantsFor("orchestrator"), []);
  });
});
