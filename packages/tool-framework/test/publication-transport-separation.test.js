import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  PublishingCapabilityExecutor, PUBLISH_CAPABILITY_ID, preflightMediaTransport,
  mediaTransportFingerprint, publicationIdentityV2, sha256Canonical,
} from "../dist/index.js";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const descriptor = { capabilityId: PUBLISH_CAPABILITY_ID };
const resolver = { resolve: () => descriptor, isAuthorized: () => true };
const policy = { maxTitleLength: 200, maxDescriptionLength: 1000, maxAssetIdLength: 500, maxTags: 30, maxTagLength: 30, allowedVisibility: ["private"] };
const store = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, save: async (k, v) => m.set(k, v) }; };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "amf-pub-transport-"));
  const bytes = Buffer.from("canonical-video-bytes");
  const sha256 = hash(bytes);
  const pathA = join(dir, "a.mp4"); const pathB = join(dir, "b.mp4");
  await writeFile(pathA, bytes); await writeFile(pathB, bytes);
  const finalMediaArtifactId = "art-final-media-1";
  const payload = { assetId: finalMediaArtifactId, title: "Private canary", options: { visibility: "private" } };
  const publicationPayloadHash = sha256Canonical(payload);
  const publicationIdentity = publicationIdentityV2({ projectId: "morroway", workflowId: "wf-1", finalMediaSha256: sha256, targetPlatform: "youtube", targetAccountId: "channel-1", publicationPayloadHash });
  const authority = { approvalId: "approval-1", decision: "approved", scope: "PRIVATE_VALIDATION", projectId: "morroway", workflowId: "wf-1", projectMode: "PRODUCTION", finalMediaArtifactId, finalMediaSha256: sha256, finalProductReviewId: "review-1", targetPlatform: "youtube", targetAccountId: "channel-1", publicationPayloadHash, publicationIdentity };
  return { dir, bytes, sha256, pathA, pathB, finalMediaArtifactId, publicationIdentity, authority };
}

const request = (f, transport, over = {}) => ({ requestId: "r-1", capabilityId: PUBLISH_CAPABILITY_ID, operation: "publish", agentId: "publisher", workflowId: "wf-1", correlationId: "c-1", requestedAt: new Date().toISOString(), input: { projectId: "morroway", finalMediaArtifactId: f.finalMediaArtifactId, finalMediaSha256: f.sha256, mediaTransportRef: transport, targetAccountId: "channel-1", title: "Private canary", options: { visibility: "private" }, idempotencyKey: f.publicationIdentity, publicationAuthority: f.authority, ...over } });

describe("publication artifact identity / transport separation", () => {
  it("A: artifact identity is never parsed as a URL", async () => {
    const f = await fixture(); let received;
    try {
      const e = new PublishingCapabilityExecutor({ publish: async (x) => { received = x; return { providerId: "stub", status: "completed", publicationId: "p", url: "https://example.test/p" }; } }, store(), resolver, policy);
      strictEqual((await e.execute(request(f, { type: "LOCAL_FILE", path: f.pathA, expectedSha256: f.sha256 }))).status, "success");
      strictEqual(received.finalMediaArtifactId, "art-final-media-1");
      strictEqual(received.mediaTransportRef.path, f.pathA);
    } finally { await rm(f.dir, { recursive: true, force: true }); }
  });
  it("B: valid artifact plus LOCAL_FILE passes preflight", async () => { const f = await fixture(); try { strictEqual((await preflightMediaTransport({ type: "LOCAL_FILE", path: f.pathA, expectedSha256: f.sha256 }, f.sha256)).status, "PASS"); } finally { await rm(f.dir,{recursive:true,force:true}); } });
  it("C: local hash mismatch fails before transport", async () => { const f=await fixture(); try { await writeFile(f.pathA, "changed"); await assertReject(() => preflightMediaTransport({type:"LOCAL_FILE",path:f.pathA,expectedSha256:f.sha256},f.sha256),"MEDIA_TRANSPORT_SHA256_MISMATCH"); } finally { await rm(f.dir,{recursive:true,force:true}); } });
  it("D: missing local file fails before transport", async () => { const f=await fixture(); try { await assertReject(() => preflightMediaTransport({type:"LOCAL_FILE",path:join(f.dir,"missing.mp4"),expectedSha256:f.sha256},f.sha256),"MEDIA_TRANSPORT_LOCAL_FILE_UNAVAILABLE"); } finally { await rm(f.dir,{recursive:true,force:true}); } });
  it("E: HTTPS transport is independent of artifact identity", async () => { const f=await fixture(); try { const p=await preflightMediaTransport({type:"HTTPS_URL",url:"https://media.example/file.mp4",expectedSha256:f.sha256},f.sha256); strictEqual(p.type,"HTTPS_URL"); } finally { await rm(f.dir,{recursive:true,force:true}); } });
  it("F: path changes do not change authority or publication identity", async () => { const f=await fixture(); try { const a=await preflightMediaTransport({type:"LOCAL_FILE",path:f.pathA,expectedSha256:f.sha256},f.sha256); const b=await preflightMediaTransport({type:"LOCAL_FILE",path:f.pathB,expectedSha256:f.sha256},f.sha256); strictEqual(a.fingerprint,b.fingerprint); strictEqual(f.publicationIdentity,f.authority.publicationIdentity); } finally { await rm(f.dir,{recursive:true,force:true}); } });
  it("G: identical bytes at different paths have one publication identity", async () => { const f=await fixture(); try { strictEqual(mediaTransportFingerprint({type:"LOCAL_FILE",path:f.pathA,expectedSha256:f.sha256}),mediaTransportFingerprint({type:"LOCAL_FILE",path:f.pathB,expectedSha256:f.sha256})); } finally { await rm(f.dir,{recursive:true,force:true}); } });
  it("H: changed bytes invalidate authority before provider", async () => { const f=await fixture(); let calls=0; try { await writeFile(f.pathA,"changed"); const e=new PublishingCapabilityExecutor({publish:async()=>{calls++;throw new Error("no");}},store(),resolver,policy); strictEqual((await e.execute(request(f,{type:"LOCAL_FILE",path:f.pathA,expectedSha256:f.sha256}))).status,"blocked"); strictEqual(calls,0); } finally { await rm(f.dir,{recursive:true,force:true}); } });
  it("I: capability output retains canonical final-media lineage", async () => { const f=await fixture(); try { const e=new PublishingCapabilityExecutor({publish:async()=>({providerId:"stub",status:"completed",publicationId:"p",url:"https://example.test/p"})},store(),resolver,policy); const r=await e.execute(request(f,{type:"LOCAL_FILE",path:f.pathA,expectedSha256:f.sha256})); strictEqual(r.output.finalMediaArtifactId,f.finalMediaArtifactId); strictEqual(r.output.finalMediaSha256,f.sha256); } finally { await rm(f.dir,{recursive:true,force:true}); } });
  it("J: provider receives transport separately, never artifact ID as a URL", async () => { const f=await fixture(); let got; try { const e=new PublishingCapabilityExecutor({publish:async(x)=>{got=x;return {providerId:"stub",status:"completed",publicationId:"p",url:"https://example.test/p"};}},store(),resolver,policy); await e.execute(request(f,{type:"LOCAL_FILE",path:f.pathA,expectedSha256:f.sha256})); strictEqual(got.mediaTransportRef.type,"LOCAL_FILE"); ok(!got.finalMediaArtifactId.includes("://")); } finally { await rm(f.dir,{recursive:true,force:true}); } });
  it("K: exact canary-shaped local publication passes provider-free preflight", async () => { const f=await fixture(); try { const e=new PublishingCapabilityExecutor({publish:async()=>({providerId:"stub",status:"completed",publicationId:"p",url:"https://example.test/p"})},store(),resolver,policy); strictEqual((await e.execute(request(f,{type:"LOCAL_FILE",path:f.pathA,expectedSha256:f.sha256,expectedByteCount:f.bytes.length,mimeType:"video/mp4"}))).status,"success"); } finally { await rm(f.dir,{recursive:true,force:true}); } });
  it("L: all transport failures above make zero provider calls", async () => { const f=await fixture(); let calls=0; try { const e=new PublishingCapabilityExecutor({publish:async()=>{calls++;throw new Error("no");}},store(),resolver,policy); const r=await e.execute(request(f,{type:"LOCAL_FILE",path:join(f.dir,"missing.mp4"),expectedSha256:f.sha256})); strictEqual(r.status,"blocked"); strictEqual(calls,0); } finally { await rm(f.dir,{recursive:true,force:true}); } });
});

async function assertReject(fn, code) { let value=""; try { await fn(); } catch (e) { value=e.message; } strictEqual(value,code); }
