/** M4 private-visibility hard guard (deterministic, no provider calls). */

import { describe, it } from "node:test";
import { strictEqual, throws } from "node:assert";
import { requirePrivateVisibility } from "@ai-media-factory/provider-adapters";

describe("requirePrivateVisibility", () => {
  it("accepts exactly private", () => {
    strictEqual(requirePrivateVisibility("private"), "private");
  });

  it("blocks public and unlisted before any provider call", () => {
    throws(() => requirePrivateVisibility("public"), /PRIVATE_VISIBILITY_REQUIRED/);
    throws(() => requirePrivateVisibility("unlisted"), /PRIVATE_VISIBILITY_REQUIRED/);
  });

  it("blocks unset, malformed, and case variants", () => {
    throws(() => requirePrivateVisibility(undefined), /PRIVATE_VISIBILITY_REQUIRED/);
    throws(() => requirePrivateVisibility(null), /PRIVATE_VISIBILITY_REQUIRED/);
    throws(() => requirePrivateVisibility(""), /PRIVATE_VISIBILITY_REQUIRED/);
    throws(() => requirePrivateVisibility("PRIVATE"), /PRIVATE_VISIBILITY_REQUIRED/);
    throws(() => requirePrivateVisibility(0), /PRIVATE_VISIBILITY_REQUIRED/);
  });
});
