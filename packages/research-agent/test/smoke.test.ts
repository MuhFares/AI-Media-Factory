/** Smoke test for the public ResearchAgent factory. */

import { it } from "node:test";
import { strictEqual } from "node:assert";
import { createResearchAgent } from "../dist/index.js";

it("creates a dependency-injected research agent", () => {
  const agent = createResearchAgent({
    config: {},
    execute: async () => {
      throw new Error("not invoked in factory smoke test");
    },
  });

  strictEqual(agent.id, "research");
  strictEqual(agent.name, "Research Agent");
});
