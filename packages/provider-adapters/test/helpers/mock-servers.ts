/**
 * Local HTTP mock servers for every provider API. Tests wire the real adapters
 * against these over real HTTP, so timeout/retry/classification/validation paths
 * are exercised end-to-end without external credentials.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

export interface MockServer<T> {
  url: string;
  server: http.Server;
  close(): Promise<void>;
  state: T;
}

function listen(handler: http.RequestListener): Promise<{ url: string; server: http.Server }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

function json(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function start<T>(state: T, handler: http.RequestListener): Promise<MockServer<T>> {
  const { url, server } = await listen(handler);
  return {
    url,
    server,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
    state,
  };
}

// -- Brave Search -------------------------------------------------------------

export type BraveMockMode = "ok" | "empty" | "malformed-web" | "malformed-results";

export interface BraveMockState {
  requests: number;
  authFailure: boolean;
  failuresLeft: number;
  mode: BraveMockMode;
}

export function createBraveMock(): Promise<MockServer<BraveMockState>> {
  const state: BraveMockState = { requests: 0, authFailure: false, failuresLeft: 0, mode: "ok" };
  return start(state, async (req, res) => {
    state.requests += 1;
    if (req.method !== "GET") {
      json(res, 405, { error: "method not allowed" });
      return;
    }
    if (state.authFailure) {
      json(res, 401, { error: { message: "unauthorized" } });
      return;
    }
    if (state.failuresLeft > 0) {
      state.failuresLeft -= 1;
      json(res, 500, { error: "boom" });
      return;
    }
    if (state.mode === "empty") {
      json(res, 200, { web: { results: [] } });
      return;
    }
    if (state.mode === "malformed-web") {
      json(res, 200, { web: "not-an-object" });
      return;
    }
    if (state.mode === "malformed-results") {
      json(res, 200, { web: { results: "nope" } });
      return;
    }
    json(res, 200, {
      web: {
        results: [
          { title: "First result", url: "https://example.com/1", description: "first description" },
          { title: "Broken entry", url: "not-a-valid-url", description: "will be dropped" },
          { title: "Second result", url: "https://example.org/2", description: "second description" },
        ],
      },
    });
  });
}

// -- Tavily Search -------------------------------------------------------------

export type TavilyMockMode = "ok" | "empty" | "malformed-results" | "non-json";

export interface TavilyMockState {
  requests: number;
  authFailure: boolean;
  failuresLeft: number;
  mode: TavilyMockMode;
}

export function createTavilyMock(): Promise<MockServer<TavilyMockState>> {
  const state: TavilyMockState = { requests: 0, authFailure: false, failuresLeft: 0, mode: "ok" };
  return start(state, async (req, res) => {
    if (req.method !== "POST") {
      json(res, 405, { error: "method not allowed" });
      return;
    }
    state.requests += 1;
    await readBody(req);
    if (state.authFailure) {
      json(res, 401, { error: { message: "unauthorized" } });
      return;
    }
    if (state.failuresLeft > 0) {
      state.failuresLeft -= 1;
      json(res, 500, { error: "boom" });
      return;
    }
    if (state.mode === "empty") {
      json(res, 200, { query: "test", results: [] });
      return;
    }
    if (state.mode === "malformed-results") {
      json(res, 200, { query: "test", results: "nope" });
      return;
    }
    if (state.mode === "non-json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("this is not json");
      return;
    }
    json(res, 200, {
      query: "test",
      results: [
        { title: "First result", url: "https://example.com/1", content: "first content", score: 0.9 },
        { title: "Broken entry", url: "not-a-valid-url", content: "will be dropped", score: 0.8 },
        { title: "Second result", url: "https://example.org/2", content: "second content", score: 0.7 },
      ],
    });
  });
}

// -- Serper Search -------------------------------------------------------------

export type SerperMockMode = "ok" | "empty" | "malformed-organic" | "non-json";

export interface SerperMockState {
  requests: number;
  authFailure: boolean;
  failuresLeft: number;
  mode: SerperMockMode;
}

export function createSerperMock(): Promise<MockServer<SerperMockState>> {
  const state: SerperMockState = { requests: 0, authFailure: false, failuresLeft: 0, mode: "ok" };
  return start(state, async (req, res) => {
    if (req.method !== "POST") {
      json(res, 405, { error: "method not allowed" });
      return;
    }
    state.requests += 1;
    await readBody(req);
    if (state.authFailure) {
      json(res, 401, { error: { message: "unauthorized" } });
      return;
    }
    if (state.failuresLeft > 0) {
      state.failuresLeft -= 1;
      json(res, 500, { error: "boom" });
      return;
    }
    if (state.mode === "empty") {
      json(res, 200, { organic: [] });
      return;
    }
    if (state.mode === "malformed-organic") {
      json(res, 200, { organic: "nope" });
      return;
    }
    if (state.mode === "non-json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("this is not json");
      return;
    }
    json(res, 200, {
      organic: [
        { title: "First result", link: "https://example.com/1", snippet: "first snippet" },
        { title: "Broken entry", link: "not-a-valid-url", snippet: "will be dropped" },
        { title: "Second result", link: "https://example.org/2", snippet: "second snippet" },
      ],
    });
  });
}

// -- Exa Search ----------------------------------------------------------------

export type ExaMockMode = "ok" | "empty" | "malformed-results" | "non-json";

export interface ExaMockState {
  requests: number;
  authFailure: boolean;
  failuresLeft: number;
  mode: ExaMockMode;
}

export function createExaMock(): Promise<MockServer<ExaMockState>> {
  const state: ExaMockState = { requests: 0, authFailure: false, failuresLeft: 0, mode: "ok" };
  return start(state, async (req, res) => {
    if (req.method !== "POST") {
      json(res, 405, { error: "method not allowed" });
      return;
    }
    state.requests += 1;
    await readBody(req);
    if (state.authFailure) {
      json(res, 401, { error: { message: "unauthorized" } });
      return;
    }
    if (state.failuresLeft > 0) {
      state.failuresLeft -= 1;
      json(res, 500, { error: "boom" });
      return;
    }
    if (state.mode === "empty") {
      json(res, 200, { results: [] });
      return;
    }
    if (state.mode === "malformed-results") {
      json(res, 200, { results: "nope" });
      return;
    }
    if (state.mode === "non-json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("this is not json");
      return;
    }
    json(res, 200, {
      results: [
        { title: "First result", url: "https://example.com/1", text: "first text", score: 0.9 },
        { title: "Broken entry", url: "not-a-valid-url", text: "will be dropped", score: 0.8 },
        { title: "Second result", url: "https://example.org/2", text: "second text", score: 0.7 },
      ],
    });
  });
}

// -- OpenAI Images ------------------------------------------------------------

export type ImageMockMode = "ok" | "unauthorized" | "provider-error" | "no-data" | "non-json";

export interface ImageMockState {
  requests: number;
  mode: ImageMockMode;
  lastBody: unknown;
}

export function createImageMock(): Promise<MockServer<ImageMockState>> {
  const state: ImageMockState = { requests: 0, mode: "ok", lastBody: null };
  return start(state, async (req, res) => {
    if (req.method !== "POST") {
      json(res, 405, { error: "method not allowed" });
      return;
    }
    state.requests += 1;
    state.lastBody = JSON.parse(await readBody(req));
    if (state.mode === "unauthorized") {
      json(res, 401, { error: { message: "Invalid API key" } });
      return;
    }
    if (state.mode === "provider-error") {
      json(res, 400, { error: { message: "billing_hard_limit_reached", code: 400 } });
      return;
    }
    if (state.mode === "no-data") {
      json(res, 200, { created: 1700000000, data: [] });
      return;
    }
    if (state.mode === "non-json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("this is not json");
      return;
    }
    json(res, 200, {
      created: 1700000000,
      data: [{ b64_json: "QUJDREVG", revised_prompt: "revised" }],
    });
  });
}

// -- Replicate ----------------------------------------------------------------

export type ReplicateMockMode = "ok" | "fail" | "never-completes" | "no-output" | "submit-fails";

export interface ReplicateMockState {
  submissions: number;
  polls: number;
  mode: ReplicateMockMode;
  jobs: Map<string, { stage: number; status: string }>;
}

export function createReplicateMock(): Promise<MockServer<ReplicateMockState>> {
  const state: ReplicateMockState = {
    submissions: 0,
    polls: 0,
    mode: "ok",
    jobs: new Map(),
  };
  let counter = 0;
  return start(state, async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "POST" && url.pathname === "/v1/predictions") {
      state.submissions += 1;
      if (state.mode === "submit-fails") {
        json(res, 500, { detail: "submit failed" });
        return;
      }
      counter += 1;
      const id = `job-${counter}`;
      state.jobs.set(id, { stage: 0, status: "starting" });
      json(res, 201, { id, status: "starting", output: null, error: null });
      return;
    }
    const match = /^\/v1\/predictions\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && match !== null) {
      state.polls += 1;
      const job = state.jobs.get(match[1]);
      if (job === undefined) {
        json(res, 404, { detail: "not found" });
        return;
      }
      job.stage += 1;
      if (state.mode === "never-completes") {
        job.status = "processing";
      } else if (job.stage >= 2) {
        job.status = state.mode === "fail" ? "failed" : "succeeded";
      } else {
        job.status = "processing";
      }
      const body: Record<string, unknown> = {
        id: job.id ?? match[1],
        status: job.status,
        output: null,
        error: null,
      };
      if (job.status === "succeeded") {
        body.output = state.mode === "no-output" ? [] : ["https://cdn.replicate.example/video.mp4"];
      }
      if (job.status === "failed") {
        body.error = { message: "model failed on this input" };
      }
      json(res, 200, body);
      return;
    }
    json(res, 404, { detail: "not found" });
  });
}

// -- YouTube Publishing ---------------------------------------------------------

export interface YouTubeVideoRecord {
  id: string;
  title: string;
  description: string;
  visibility: string;
  publishedAt: string;
}

export type PublishMockMode = "ok" | "unauthorized" | "fail-upload-once" | "reject-large" | "no-session";

export interface PublishMockState {
  inits: number;
  uploads: number;
  searchRequests: number;
  markerVideos: Map<string, YouTubeVideoRecord>;
  sessions: Map<string, { marker: string; videoId?: string }>;
  mode: PublishMockMode;
}

export function createYouTubePublishMock(): Promise<MockServer<PublishMockState>> {
  const state: PublishMockState = {
    inits: 0,
    uploads: 0,
    searchRequests: 0,
    markerVideos: new Map(),
    sessions: new Map(),
    mode: "ok",
  };
  let counter = 0;
  let baseUrl = "";
  const handler: http.RequestListener = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");

    if (req.method === "GET" && url.pathname === "/youtube/v3/search") {
      state.searchRequests += 1;
      const q = url.searchParams.get("q") ?? "";
      const items = Array.from(state.markerVideos.entries())
        .filter(([, video]) => video.description.includes(q))
        .map(([marker, video]) => ({
          id: { videoId: video.id },
          snippet: {
            title: video.title,
            description: video.description,
            publishedAt: video.publishedAt,
          },
        }));
      json(res, 200, { items });
      return;
    }

    if (req.method === "POST" && url.pathname === "/upload/youtube/v3/videos") {
      state.inits += 1;
      if (state.mode === "unauthorized") {
        json(res, 401, { error: { code: 401, message: "Invalid Credentials" } });
        return;
      }
      const initBody = JSON.parse(await readBody(req));
      const description = initBody?.snippet?.description ?? "";
      const markerMatch = /\[amf-id ([0-9a-f]+)\]/.exec(description);
      const marker = markerMatch === null ? `unmarked-${counter + 1}` : markerMatch[1];
      counter += 1;
      const sessionId = `session-${counter}`;
      state.sessions.set(sessionId, { marker });
      res.writeHead(200, { Location: `${baseUrl}/resumable/${sessionId}` });
      res.end();
      return;
    }

    const sessionMatch = /^\/resumable\/([^/]+)$/.exec(url.pathname);
    if (req.method === "PUT" && sessionMatch !== null) {
      state.uploads += 1;
      const sessionId = sessionMatch[1];
      const session = state.sessions.get(sessionId);
      if (session === undefined) {
        json(res, 404, { error: { code: 404, message: "session not found" } });
        return;
      }
      if (state.mode === "reject-large") {
        json(res, 413, { error: { code: 413, message: "request too large" } });
        return;
      }
      await readBody(req);
      if (state.mode === "fail-upload-once" && session.videoId === undefined) {
        counter += 1;
        const id = `vid-${counter}`;
        session.videoId = id;
        state.markerVideos.set(session.marker, {
          id,
          title: "video",
          description: `[amf-id ${session.marker}]`,
          visibility: "private",
          publishedAt: "2026-01-02T03:04:05.000Z",
        });
        json(res, 500, { error: { code: 500, message: "upload failed" } });
        return;
      }
      if (session.videoId === undefined) {
        counter += 1;
        const id = `vid-${counter}`;
        session.videoId = id;
        state.markerVideos.set(session.marker, {
          id,
          title: "video",
          description: `[amf-id ${session.marker}]`,
          visibility: "private",
          publishedAt: "2026-01-02T03:04:05.000Z",
        });
      }
      const video = state.markerVideos.get(session.marker)!;
      json(res, 200, {
        id: video.id,
        snippet: { title: video.title, description: video.description, publishedAt: video.publishedAt },
        status: { privacyStatus: video.visibility },
      });
      return;
    }

    json(res, 404, { error: { code: 404, message: "not found" } });
  };
  return listen(handler).then(({ url, server }) => {
    baseUrl = url;
    return {
      url,
      server,
      close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
      state,
    };
  });
}

// -- YouTube Analytics -----------------------------------------------------------

export type AnalyticsMockMode = "ok" | "empty" | "unauthorized" | "malformed-rows" | "provider-error";

export interface AnalyticsMockState {
  requests: number;
  mode: AnalyticsMockMode;
  lastUrl: string;
}

// -- Media asset download --------------------------------------------------------

export interface MediaMockState {
  requests: number;
  size: number;
  serveError: boolean;
}

/** Serves a downloadable media asset (the "generated video" for publishing). */
export function createMediaMock(): Promise<MockServer<MediaMockState>> {
  const state: MediaMockState = { requests: 0, size: 4096, serveError: false };
  const blob = Buffer.alloc(4096, 0x42);
  return start(state, (req, res) => {
    state.requests += 1;
    if (state.serveError) {
      res.writeHead(500);
      res.end("media unavailable");
      return;
    }
    res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(blob.length) });
    res.end(blob);
  });
}

export function createAnalyticsMock(): Promise<MockServer<AnalyticsMockState>> {
  const state: AnalyticsMockState = { requests: 0, mode: "ok", lastUrl: "" };
  return start(state, async (req, res) => {
    if (req.method !== "GET") {
      json(res, 405, { error: "method not allowed" });
      return;
    }
    state.requests += 1;
    state.lastUrl = req.url ?? "";
    if (state.mode === "unauthorized") {
      json(res, 403, { error: { code: 403, message: "Forbidden" } });
      return;
    }
    if (state.mode === "provider-error") {
      json(res, 200, { error: { code: "quotaExceeded", message: "quota" } });
      return;
    }
    if (state.mode === "malformed-rows") {
      json(res, 200, { rows: "nope", columnHeaders: [] });
      return;
    }
    if (state.mode === "empty") {
      json(res, 200, { columnHeaders: [{ name: "views" }], rows: [] });
      return;
    }
    json(res, 200, {
      columnHeaders: [
        { name: "video", columnType: "DIMENSION" },
        { name: "views", columnType: "METRIC" },
        { name: "estimatedMinutesWatched", columnType: "METRIC" },
        { name: "likes", columnType: "METRIC" },
        { name: "comments", columnType: "METRIC" },
        { name: "shares", columnType: "METRIC" },
        { name: "estimatedRevenue", columnType: "METRIC" },
      ],
      rows: [["vid-1", 1234, 56.5, 42, 7, 3, 12.34]],
    });
  });
}

// -- RunPod ComfyUI (FLUX) -----------------------------------------------------

export interface RunPodMockState {
  runRequests: number;
  pollRequests: number;
  runStatus: number;
  pollStatus: string;
  completeMode: "ok" | "no-image" | "invalid-b64" | "malformed";
  pollFailuresLeft: number;
  lastRunBody: unknown;
  lastRunHeaders: Record<string, string>;
}

export function createRunPodMock(): Promise<MockServer<RunPodMockState>> {
  const VALID_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64").padEnd(120, "A");
  const state: RunPodMockState = {
    runRequests: 0,
    pollRequests: 0,
    runStatus: 200,
    pollStatus: "COMPLETED",
    completeMode: "ok",
    pollFailuresLeft: 0,
    lastRunBody: null,
    lastRunHeaders: {},
  };
  const handler: http.RequestListener = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "POST" && url.pathname.endsWith("/run")) {
      state.runRequests += 1;
      state.lastRunBody = JSON.parse(await readBody(req));
      state.lastRunHeaders = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
      if (state.runStatus !== 200) {
        json(res, state.runStatus, { error: "unauthorized" });
        return;
      }
      json(res, 200, { id: "job-123", status: "IN_QUEUE" });
      return;
    }
    if (req.method === "GET" && url.pathname.includes("/status/")) {
      state.pollRequests += 1;
      if (state.pollFailuresLeft > 0) {
        state.pollFailuresLeft -= 1;
        json(res, 500, { error: "boom" });
        return;
      }
      if (state.pollStatus === "FAILED" || state.pollStatus === "CANCELLED") {
        json(res, 200, { id: "job-123", status: state.pollStatus, error: "job failed" });
        return;
      }
      if (state.completeMode === "no-image") {
        json(res, 200, { id: "job-123", status: "COMPLETED", output: {} });
        return;
      }
      if (state.completeMode === "invalid-b64") {
        json(res, 200, { id: "job-123", status: "COMPLETED", output: { images: [{ data: "not-valid!!!" }] } });
        return;
      }
      if (state.completeMode === "malformed") {
        json(res, 200, "not-an-object" as unknown as Record<string, unknown>);
        return;
      }
      json(res, 200, { id: "job-123", status: "COMPLETED", output: { images: [{ data: VALID_B64 }] } });
      return;
    }
    json(res, 404, { error: "not found" });
  };
  return start(state, handler);
}

// -- RunPod Wan2.2 video -------------------------------------------------------

export interface RunPodVideoMockState {
  runRequests: number;
  pollRequests: number;
  runStatus: number;
  pollStatus: string;
  completeMode: "ok" | "no-video" | "invalid-b64" | "malformed";
  pollFailuresLeft: number;
  lastRunBody: Record<string, unknown> | null;
  lastRunHeaders: Record<string, string>;
}

export function createRunPodVideoMock(): Promise<MockServer<RunPodVideoMockState>> {
  const VALID_VIDEO_B64 = Buffer.from("mp4-header-test").toString("base64").padEnd(1200, "A");
  const state: RunPodVideoMockState = {
    runRequests: 0,
    pollRequests: 0,
    runStatus: 200,
    pollStatus: "COMPLETED",
    completeMode: "ok",
    pollFailuresLeft: 0,
    lastRunBody: null,
    lastRunHeaders: {},
  };
  const handler: http.RequestListener = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "POST" && url.pathname.endsWith("/run")) {
      state.runRequests += 1;
      state.lastRunBody = JSON.parse(await readBody(req)) as Record<string, unknown>;
      state.lastRunHeaders = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
      if (state.runStatus !== 200) {
        json(res, state.runStatus, { error: "unauthorized" });
        return;
      }
      json(res, 200, { id: "job-v123", status: "IN_QUEUE" });
      return;
    }
    if (req.method === "GET" && url.pathname.includes("/status/")) {
      state.pollRequests += 1;
      if (state.pollFailuresLeft > 0) {
        state.pollFailuresLeft -= 1;
        json(res, 500, { error: "boom" });
        return;
      }
      if (state.pollStatus === "FAILED" || state.pollStatus === "CANCELLED") {
        json(res, 200, { id: "job-v123", status: state.pollStatus, error: "job failed" });
        return;
      }
      if (state.completeMode === "no-video") {
        json(res, 200, { id: "job-v123", status: "COMPLETED", output: {} });
        return;
      }
      if (state.completeMode === "invalid-b64") {
        json(res, 200, { id: "job-v123", status: "COMPLETED", output: { video: "not-valid!!!" } });
        return;
      }
      if (state.completeMode === "malformed") {
        json(res, 200, "not-an-object" as unknown as Record<string, unknown>);
        return;
      }
      json(res, 200, { id: "job-v123", status: "COMPLETED", output: { video: VALID_VIDEO_B64 } });
      return;
    }
    json(res, 404, { error: "not found" });
  };
  return start(state, handler);
}
// -- Groq TTS (Orpheus speech) -------------------------------------------------

export interface GroqTTSMockState {
  requests: number;
  lastBody: Record<string, unknown> | null;
  lastHeaders: Record<string, string>;
  statusMode: "ok" | "unauthorized" | "forbidden" | "rate-limited" | "server-error";
  audioMode: "ok" | "empty" | "not-wav" | "malformed-json";
  failFirstN: number;
}

/** Builds a minimal valid PCM WAV (44-byte header + data). */
export function buildTestWav(samples = 2205, sampleRate = 24000): Buffer {
  const dataLength = samples * 2;
  const buf = Buffer.alloc(44 + dataLength);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples; i += 1) buf.writeInt16LE(((i % 100) - 50) * 100, 44 + i * 2);
  return buf;
}

export function createGroqTTSMock(): Promise<MockServer<GroqTTSMockState>> {
  const wav = buildTestWav();
  const state: GroqTTSMockState = {
    requests: 0,
    lastBody: null,
    lastHeaders: {},
    statusMode: "ok",
    audioMode: "ok",
    failFirstN: 0,
  };
  const handler: http.RequestListener = async (req, res) => {
    state.requests += 1;
    state.lastBody = JSON.parse(await readBody(req)) as Record<string, unknown>;
    state.lastHeaders = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    if (state.failFirstN > 0) {
      state.failFirstN -= 1;
      json(res, 500, { error: { message: "boom" } });
      return;
    }
    if (state.statusMode === "unauthorized") {
      json(res, 401, { error: { message: "Invalid API key" } });
      return;
    }
    if (state.statusMode === "forbidden") {
      json(res, 403, { error: { message: "Forbidden" } });
      return;
    }
    if (state.statusMode === "rate-limited") {
      json(res, 429, { error: { message: "rate limited" } });
      return;
    }
    if (state.statusMode === "server-error") {
      json(res, 500, { error: { message: "boom" } });
      return;
    }
    if (state.audioMode === "empty") {
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.end();
      return;
    }
    if (state.audioMode === "not-wav") {
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.end(Buffer.from("this is not audio at all"));
      return;
    }
    if (state.audioMode === "malformed-json") {
      json(res, 200, { unexpected: "json-not-audio" });
      return;
    }
    res.writeHead(200, { "Content-Type": "audio/wav" });
    res.end(wav);
  };
  return start(state, handler);
}

// -- VoiceTuT TTS (RunPod serverless) ------------------------------------------

export interface VoicetutTTSMockState {
  submissions: number;
  polls: number;
  submitStatus: number;
  jobStatus: string;
  audioMode: "ok" | "empty" | "handler-error" | "not-wav";
  pollFailuresLeft: number;
  lastRunBody: Record<string, unknown> | null;
  lastRunHeaders: Record<string, string>;
}

export function createVoicetutTTSMock(): Promise<MockServer<VoicetutTTSMockState>> {
  const wav = buildTestWav();
  const state: VoicetutTTSMockState = {
    submissions: 0,
    polls: 0,
    submitStatus: 200,
    jobStatus: "COMPLETED",
    audioMode: "ok",
    pollFailuresLeft: 0,
    lastRunBody: null,
    lastRunHeaders: {},
  };
  let counter = 0;
  const jobs = new Map<string, string>();
  const handler: http.RequestListener = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "POST" && url.pathname.endsWith("/run")) {
      state.submissions += 1;
      state.lastRunBody = JSON.parse(await readBody(req)) as Record<string, unknown>;
      state.lastRunHeaders = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
      if (state.submitStatus !== 200) {
        json(res, state.submitStatus, { error: "unauthorized" });
        return;
      }
      counter += 1;
      const id = `vt-job-${counter}`;
      jobs.set(id, "pending");
      json(res, 200, { id, status: "IN_QUEUE" });
      return;
    }
    const match = /\/status\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && match !== null) {
      state.polls += 1;
      if (state.pollFailuresLeft > 0) {
        state.pollFailuresLeft -= 1;
        json(res, 500, { error: "boom" });
        return;
      }
      if (state.jobStatus !== "COMPLETED") {
        json(res, 200, { id: match[1], status: state.jobStatus, error: "job failed" });
        return;
      }
      const output: Record<string, unknown> =
        state.audioMode === "empty"
          ? {}
          : state.audioMode === "handler-error"
            ? { error: "synthesis failed: model exploded" }
            : state.audioMode === "not-wav"
              ? { audio: Buffer.from("not audio at all").toString("base64"), format: "wav" }
              : { audio: wav.toString("base64"), format: "wav", voice: "Mohamed", duration_seconds: 2.5 };
      json(res, 200, { id: match[1], status: state.jobStatus === "COMPLETED" ? "COMPLETED" : state.jobStatus, output });
      return;
    }
    json(res, 404, { error: "not found" });
  };
  return start(state, handler);
}
