/** Smoke test for the public ReviewerAgent factory. */

import { it } from "node:test";
import { strictEqual } from "node:assert";
import { createReviewerAgent } from "../dist/index.js";

it("creates a dependency-injected reviewer agent", () => {
  const agent = createReviewerAgent({
    config: {},
    execute: async () => {
      throw new Error("not invoked in factory smoke test");
    },
  });

  strictEqual(agent.id, "reviewer");
  strictEqual(agent.name, "Reviewer Agent");
});
