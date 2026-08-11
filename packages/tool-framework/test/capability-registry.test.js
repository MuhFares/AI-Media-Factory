import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok, throws } from "node:assert";
import {
  DefaultCapabilityRegistry,
  DefaultAuthorizationPolicy,
  createCapabilityRegistry,
} from "../dist/index.js";

function descriptor(capabilityId, description = `Description for ${capabilityId}`) {
  return {
    capabilityId,
    description,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
  };
}

const FILESYSTEM = "filesystem";
const COMMAND = "execution.command";
const WEB_SEARCH = "web.search";

describe("capability registry", () => {
  it("registers a capability definition and lists it deterministically", () => {
    const registry = new DefaultCapabilityRegistry();
    registry.register(descriptor(FILESYSTEM));
    registry.register(descriptor(COMMAND));
    registry.register(descriptor(WEB_SEARCH));

    const listed = registry.list();
    deepStrictEqual(listed.map((d) => d.capabilityId), [FILESYSTEM, COMMAND, WEB_SEARCH]);
    strictEqual(listed[0].description, "Description for filesystem");
  });

  it("resolves a registered capability descriptor", () => {
    const registry = new DefaultCapabilityRegistry();
    registry.register(descriptor(WEB_SEARCH));
    const resolved = registry.resolve(WEB_SEARCH);
    strictEqual(resolved?.capabilityId, WEB_SEARCH);
    deepStrictEqual(resolved, { ...descriptor(WEB_SEARCH) });
  });

  it("unregisters a capability and removes it from resolution and listing", () => {
    const registry = new DefaultCapabilityRegistry();
    registry.register(descriptor(FILESYSTEM));
    registry.register(descriptor(COMMAND));
    strictEqual(registry.unregister(FILESYSTEM), true);
    strictEqual(registry.unregister(FILESYSTEM), false);
    strictEqual(registry.resolve(FILESYSTEM), null);
    deepStrictEqual(registry.list().map((d) => d.capabilityId), [COMMAND]);
  });

  it("returns null for an unknown (unregistered) capability", () => {
    const registry = new DefaultCapabilityRegistry();
    strictEqual(registry.resolve("image.generation"), null);
    strictEqual(registry.resolve("nonexistent"), null);
  });

  it("rejects duplicate registration and malformed descriptors", () => {
    const registry = new DefaultCapabilityRegistry();
    registry.register(descriptor(FILESYSTEM));
    throws(() => registry.register(descriptor(FILESYSTEM)), /already registered/);
    throws(() => registry.register({ capabilityId: "", description: "x", inputSchema: {}, outputSchema: {} }), /capabilityId/);
    throws(() => registry.register(descriptor("")), /capabilityId/);
  });

  it("authorizes an explicitly granted agent/capability pair", () => {
    const policy = new DefaultAuthorizationPolicy();
    policy.grant("research", WEB_SEARCH);
    const registry = new DefaultCapabilityRegistry({ policy });
    registry.register(descriptor(WEB_SEARCH));
    strictEqual(registry.isAuthorized("research", WEB_SEARCH), true);
  });

  it("denies an unauthorized pair and an unknown agent (deny by default)", () => {
    const policy = new DefaultAuthorizationPolicy();
    policy.grant("research", WEB_SEARCH);
    const registry = new DefaultCapabilityRegistry({ policy });
    registry.register(descriptor(WEB_SEARCH));
    registry.register(descriptor(COMMAND));

    strictEqual(registry.isAuthorized("research", COMMAND), false);
    strictEqual(registry.isAuthorized("unknown-agent", WEB_SEARCH), false);
    strictEqual(registry.isAuthorized("research", "nonexistent"), false);
  });

  it("denies an unregistered capability even when granted", () => {
    const policy = new DefaultAuthorizationPolicy();
    policy.grant("coding", FILESYSTEM);
    const registry = new DefaultCapabilityRegistry({ policy });
    // FILESYSTEM is granted but never registered -> not authorized.
    strictEqual(registry.isAuthorized("coding", FILESYSTEM), false);
  });

  it("grants are exact-match only and never wildcard", () => {
    const policy = new DefaultAuthorizationPolicy();
    throws(() => policy.grant("coding", "filesystem.*"), /wildcard/);
    policy.grant("coding", "filesystem.read");
    strictEqual(policy.isAuthorized("coding", "filesystem.read"), true);
    strictEqual(policy.isAuthorized("coding", "filesystem.write"), false);
    strictEqual(policy.isAuthorized("coding", "filesystem"), false);
  });

  it("does not expose any execution surface", async () => {
    const registry = new DefaultCapabilityRegistry();
    registry.register(descriptor(COMMAND));
    ok(typeof registry.execute !== "function", "registry must not execute capabilities");
    ok(typeof registry.runCapabilities !== "function", "registry must not run capabilities");
    ok(typeof registry.executeCapability !== "function", "registry must not execute a capability");
  });

  it("initializes deterministically from configuration", () => {
    const grants = [
      { agentId: "research", capabilityIds: [WEB_SEARCH] },
      { agentId: "coding", capabilityIds: [FILESYSTEM, COMMAND] },
      { agentId: "qa", capabilityIds: [COMMAND] },
    ];
    const a = createCapabilityRegistry({
      capabilities: [descriptor(FILESYSTEM), descriptor(COMMAND), descriptor(WEB_SEARCH)],
      grants,
    });
    const b = createCapabilityRegistry({
      capabilities: [descriptor(FILESYSTEM), descriptor(COMMAND), descriptor(WEB_SEARCH)],
      grants,
    });

    deepStrictEqual(a.list().map((d) => d.capabilityId), b.list().map((d) => d.capabilityId));
    deepStrictEqual(
      ["research", "coding", "qa"].map((agent) => a.getAuthorizationPolicy().grantsFor(agent)),
      ["research", "coding", "qa"].map((agent) => b.getAuthorizationPolicy().grantsFor(agent)),
    );
    strictEqual(a.isAuthorized("coding", FILESYSTEM), true);
    strictEqual(a.isAuthorized("qa", COMMAND), true);
    strictEqual(a.isAuthorized("research", FILESYSTEM), false);
    strictEqual(a.isAuthorized("coding", WEB_SEARCH), false);
  });

  it("revokes grants", () => {
    const policy = new DefaultAuthorizationPolicy();
    policy.grant("qa", COMMAND);
    strictEqual(policy.isAuthorized("qa", COMMAND), true);
    strictEqual(policy.revoke("qa", COMMAND), true);
    strictEqual(policy.revoke("qa", COMMAND), false);
    strictEqual(policy.isAuthorized("qa", COMMAND), false);
  });
});
