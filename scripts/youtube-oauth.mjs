/**
 * BREAK-GLASS / ENGINEERING-ONLY YouTube OAuth CLI (Desktop loopback flow).
 *
 *   node scripts/youtube-oauth.mjs bootstrap --client <outside-repo-client-json> --credential <outside-repo-token-file>
 *   node scripts/youtube-oauth.mjs status --credential <outside-repo-token-file>
 *   node scripts/youtube-oauth.mjs verify-channel --credential <outside-repo-token-file>
 *   node scripts/youtube-oauth.mjs refresh --credential <outside-repo-token-file>
 *
 * Normal Owner operation uses AMF Control -> Credentials -> Verify Health.
 * Secrets are NEVER printed, logged, or written into the repository.
 * Client/token paths inside the repository are refused outright.
 */
import { createServer } from "node:http";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readDesktopClientJson, buildAuthorizeUrl, loopbackRedirectUri, browserOpenCommand,
  exchangeCode, persistCredential, readCredential, refreshAccessToken,
  verifyChannel, credentialStatus, YOUTUBE_OAUTH_SCOPES,
} from "../packages/provider-adapters/dist/oauth/youtube-oauth.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = path.resolve(process.cwd());
const BREAK_GLASS_CONFIRMATION = "credential-oauth-engineering-v1";

function usage() {
  console.log(JSON.stringify({
    usage: `node scripts/youtube-oauth.mjs <bootstrap|status|verify-channel|refresh> --confirm-break-glass=${BREAK_GLASS_CONFIRMATION} [--client <path>] --credential <path> [--expose-token-stdout]`,
    scopes: [...YOUTUBE_OAUTH_SCOPES],
    classification: "BREAK_GLASS_ONLY",
    note: "Normal operation uses AMF Control. Engineering use requires a separately recorded Owner/Admin authorization and audit reference; client and credential files must remain outside the repository.",
  }, null, 2));
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function resolveOutsideRepo(p, label) {
  if (!p) { console.log(JSON.stringify({ status: "ERROR", error: `${label} path is required` })); process.exit(2); }
  const abs = path.resolve(HERE, p);
  const rel = path.relative(REPO_ROOT, abs);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    console.log(JSON.stringify({ status: "REFUSED_REPO_PATH", error: `${label} must live outside the repository` }));
    process.exit(2);
  }
  return abs;
}

const transport = {
  async postForm(url, params) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    return res.json();
  },
  async get(url, headers) {
    const res = await fetch(url, { headers });
    return res.json();
  },
};

function openBrowser(url) {
  try {
    const { command, args } = browserOpenCommand(process.platform, url);
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch { /* URL is always printed; browser open is best-effort */ }
}

async function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({ port: server.address().port, server });
    });
  });
}

const cmd = process.argv[2];
if (!["bootstrap", "status", "verify-channel", "refresh"].includes(cmd)) { usage(); process.exit(2); }
if (!process.argv.includes(`--confirm-break-glass=${BREAK_GLASS_CONFIRMATION}`)) {
  console.log(JSON.stringify({
    status: "BREAK_GLASS_CONFIRMATION_REQUIRED",
    classification: "BREAK_GLASS_ONLY",
    normalOperation: "AMF Control -> Credentials -> Verify Health",
    auditExpectation: "Record Owner/Admin authorization, reason, target binding, and outcome in the canonical audit trail.",
  }, null, 2));
  process.exit(2);
}

const credentialPath = resolveOutsideRepo(arg("--credential"), "credential");
const exposeToken = process.argv.includes("--expose-token-stdout");
const fsDeps = {
  readFile: (p) => readFile(p, "utf8"),
  writeFile: async (p, data, mode) => { await writeFile(p, data, { mode }); try { await chmod(p, mode); } catch {} },
};

if (cmd === "status") {
  try {
    const cred = await readCredential(fsDeps, credentialPath);
    console.log(JSON.stringify({ status: "OK", credential: credentialPath, ...credentialStatus(cred) }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ status: "NO_CREDENTIAL", credential: credentialPath, error: String((e && e.message) || e) }));
    process.exit(1);
  }
} else if (cmd === "bootstrap") {
  const clientPath = resolveOutsideRepo(arg("--client"), "client");
  const client = await readDesktopClientJson(fsDeps, clientPath);
  const started = await waitForCallback();
  const redirectUri = loopbackRedirectUri(started.port);
  const state = randomBytes(16).toString("hex");
  const url = buildAuthorizeUrl(client.clientId, redirectUri, state);
  openBrowser(url);
  console.log(JSON.stringify({ status: "AWAITING_CONSENT", authorizeUrl: url, note: "Opened in browser if possible; loopback callback armed." }, null, 2));
  const got = await new Promise((resolve, reject) => {
    const inner = started.server;
    inner.on("request", (req, res) => {
      try {
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        const code = u.searchParams.get("code") ?? "";
        const rst = u.searchParams.get("state") ?? "";
        const err = u.searchParams.get("error") ?? "";
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(err ? "Authorization declined; you may close this tab." : "Authorization received; you may close this tab.");
        inner.close();
        if (err) reject(new Error(`OAUTH_CONSENT_${err}`));
        else if (rst !== state) reject(new Error("OAUTH_STATE_MISMATCH"));
        else resolve({ code });
      } catch (e) { try { inner.close(); } catch {} reject(e); }
    });
    setTimeout(() => { try { inner.close(); } catch {} reject(new Error("OAUTH_CONSENT_TIMEOUT")); }, 10 * 60 * 1000);
  });
  const tokens = await exchangeCode(transport, client, got.code, redirectUri);
  await persistCredential(fsDeps, credentialPath, {
    provider: "google", type: "youtube-oauth-desktop",
    clientId: client.clientId, clientSecret: client.clientSecret,
    refreshToken: tokens.refreshToken, scopes: [...YOUTUBE_OAUTH_SCOPES],
    obtainedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({
    status: "CREDENTIAL_STORED", credential: credentialPath,
    scopes: [...YOUTUBE_OAUTH_SCOPES], accessTokenExpiresIn: tokens.expiresIn,
    note: "Refresh credential stored owner-locally. Access token held in memory only and not printed.",
  }, null, 2));
} else {
  const cred = await readCredential(fsDeps, credentialPath);
  if (cmd === "verify-channel") {
    const { accessToken } = await refreshAccessToken(transport, cred);
    const ch = await verifyChannel(transport, accessToken);
    console.log(JSON.stringify({
      status: "CHANNEL_VERIFIED", channelId: ch.channelId, channelTitle: ch.channelTitle,
      uploadCapable: false, readOnly: true,
      note: "Verification performed exactly one read-only channels.list call; nothing was uploaded.",
    }, null, 2));
  } else {
    const { expiresIn } = await refreshAccessToken(transport, cred);
    const out = {
      status: "ACCESS_TOKEN_MINTED", expiresIn,
      note: "Token held in memory only. Export it to the runtime process environment manually when authorized; never commit it.",
    };
    if (exposeToken) {
      console.log(JSON.stringify({ ...out, warning: "explicit opt-in: do not redirect stdout to files or logs" }, null, 2));
    } else {
      console.log(JSON.stringify(out, null, 2));
    }
  }
}
