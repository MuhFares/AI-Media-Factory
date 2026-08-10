/** Smoke test for the public CodingAgent factory. */

import { it } from "node:test";
import { strictEqual } from "node:assert";
import { createCodingAgent } from "../dist/index.js";

it("creates a dependency-injected coding agent", () => {
  const agent = createCodingAgent({
    config: {},
    execute: async () => {
      throw new Error("not invoked in factory smoke test");
    },
  });

  strictEqual(agent.id, "coding");
  strictEqual(agent.name, "Coding Agent");
});
