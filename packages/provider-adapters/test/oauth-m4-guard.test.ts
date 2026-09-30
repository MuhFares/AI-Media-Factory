/** M4 runtime safety matrix (mocked transport only, never Google/YouTube). */

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok, rejects } from "node:assert";
import {
  M4_CONTROLLED_CHANNEL_ID, M4_REJECTED_CHANNEL_ID,
  assertCredentialScopes, assertControlledChannel, prepareM4Upload,
  YOUTUBE_OAUTH_SCOPES,
} from "@ai-media-factory/provider-adapters";

const SECRET_REFRESH = "m4-secret-refresh-token";
const SECRET_CLIENT = "m4-secret-client";
const SECRET_ACCESS = "m4-secret-access-token";
const GOOD_CRED = {
  provider: "google", type: "youtube-oauth-desktop",
  clientId: "cid", clientSecret: SECRET_CLIENT, refreshToken: SECRET_REFRESH,
  scopes: [...YOUTUBE_OAUTH_SCOPES], obtainedAt: "t",
};
const fsFor = (cred) => ({
  readFile: async (p) => {
    if (p !== "/outside/m4-token.json") throw new Error("ENOENT");
    return JSON.stringify(cred);
  },
});
const transportFor = ({ channelId = M4_CONTROLLED_CHANNEL_ID, token = SECRET_ACCESS } = {}) => {
  const calls = [];
  return {
    calls,
    async postForm(url, params) {
      calls.push({ method: "POST", url });
      if (!params.refresh_token) throw new Error("REFRESH_TRANSPORT_FAILURE");
      return { access_token: token, expires_in: 3600 };
    },
    async get(url) {
      calls.push({ method: "GET", url });
      if (channelId === null) return { items: [] };
      return { items: [{ id: channelId, snippet: { title: "ch" } }] };
    },
  };
};
const noSecrets = (v) => {
  const dump = JSON.stringify(v);
  for (const s of [SECRET_REFRESH, SECRET_CLIENT, SECRET_ACCESS]) ok(!dump.includes(s), "secret must never appear");
};

describe("m4 runtime safety", () => {
  it("A: correct Morroway channel passes the full pre-upload order", async () => {
    const t = transportFor();
    const ready = await prepareM4Upload(fsFor(GOOD_CRED), t, {
      credentialPath: "/outside/m4-token.json", requestedVisibility: "private",
    });
    strictEqual(ready.channelId, M4_CONTROLLED_CHANNEL_ID);
    strictEqual(ready.visibility, "private");
    strictEqual(ready.accessToken, SECRET_ACCESS);
    deepStrictEqual(t.calls.map((c) => c.method), ["POST", "GET"], "refresh then exactly one read-only check");
    ok(t.calls.every((c) => !c.url.includes("videos") || c.url.includes("channels")), "no upload path entered");
    noSecrets({ channelId: ready.channelId, visibility: ready.visibility });
  });

  it("B+C+D: Muhamad Fares, arbitrary, and missing channels fail before upload", async () => {
    await rejects(
      prepareM4Upload(fsFor(GOOD_CRED), transportFor({ channelId: M4_REJECTED_CHANNEL_ID }), {
        credentialPath: "/outside/m4-token.json", requestedVisibility: "private",
      }), /M4_CHANNEL_MISMATCH/);
    strictEqual(M4_REJECTED_CHANNEL_ID, "UCCzGNVr5YQP_DC8zKOGIONA");
    await rejects(
      prepareM4Upload(fsFor(GOOD_CRED), transportFor({ channelId: "UCaaaaaaaaaaaaaaaaaaaaaa" }), {
        credentialPath: "/outside/m4-token.json", requestedVisibility: "private",
      }), /M4_CHANNEL_MISMATCH/);
    await rejects(
      prepareM4Upload(fsFor(GOOD_CRED), transportFor({ channelId: null }), {
        credentialPath: "/outside/m4-token.json", requestedVisibility: "private",
      }), /M4_CHANNEL_UNRESOLVED/);
    assertControlledChannel(M4_CONTROLLED_CHANNEL_ID);
  });

  it("E+F: missing credential and refresh failure fail closed", async () => {
    await rejects(
      prepareM4Upload({ readFile: async () => { throw new Error("ENOENT"); } }, transportFor(), {
        credentialPath: "/outside/missing.json", requestedVisibility: "private",
      }), /M4_CREDENTIAL_UNAVAILABLE/);
    const badTransport = transportFor();
    badTransport.postForm = async () => ({});
    await rejects(
      prepareM4Upload(fsFor(GOOD_CRED), badTransport, {
        credentialPath: "/outside/m4-token.json", requestedVisibility: "private",
      }), /M4_TOKEN_REFRESH_FAILED/);
  });

  it("G+H: scope proof required; correct grant passes", async () => {
    assertCredentialScopes(GOOD_CRED);
    await rejects(
      prepareM4Upload(fsFor({ ...GOOD_CRED, scopes: ["https://www.googleapis.com/auth/youtube.readonly"] }), transportFor(), {
        credentialPath: "/outside/m4-token.json", requestedVisibility: "private",
      }), /M4_SCOPE_MISSING/);
  });

  it("I+J+K+L: only exact private passes", async () => {
    const t = transportFor();
    const ready = await prepareM4Upload(fsFor(GOOD_CRED), t, {
      credentialPath: "/outside/m4-token.json", requestedVisibility: "private",
    });
    strictEqual(ready.visibility, "private");
    for (const bad of ["public", "unlisted", undefined, "", "PRIVATE", 0]) {
      await rejects(
        prepareM4Upload(fsFor(GOOD_CRED), transportFor(), {
          credentialPath: "/outside/m4-token.json", requestedVisibility: bad,
        }), /PRIVATE_VISIBILITY_REQUIRED|M4_/);
    }
  });

  it("M+N: zero upload calls; secrets never in errors", async () => {
    const t = transportFor({ channelId: M4_REJECTED_CHANNEL_ID });
    try {
      await prepareM4Upload(fsFor(GOOD_CRED), t, {
        credentialPath: "/outside/m4-token.json", requestedVisibility: "private",
      });
      ok(false, "must throw");
    } catch (e) {
      noSecrets({ message: String((e && e.message) || e), calls: t.calls });
    }
    ok(t.calls.every((c) => c.method === "POST" || (c.method === "GET" && c.url.includes("channels"))),
      "only token refresh plus channels.list ever occur");
  });
});
