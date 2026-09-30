import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MediaAgent } from "../dist/media-agent.js";

function fakeExecutor(result) {
  return {
    execute: async () => result,
    executeCapability: async () => result,
  };
}

function agentWith(executorResult, capExec = undefined) {
  const cap = capExec ?? { execute: async () => executorResult, executeCapability: async () => executorResult };
  // BaseAgent expects capabilityExecution; we inject a minimal stub
  return new MediaAgent({
    execute: async () => ({ output: {}, raw: "{}", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, model: "test", provider: "test", latencyMs: 0 }),
    capabilityExecution: {
      executeCapability: async (req) => cap.execute(req),
    },
    config: { model: "deterministic", systemPrompt: "test" },
  });
}

const successExec = {
  status: "success",
  resultId: "media-compose-result-media-compose-req1",
  capabilityId: "media.compose",
  output: {
    mediaId: "media-abc123def456",
    status: "completed",
    providerId: "ffmpeg",
    output: { mimeType: "video/mp4", path: "output/media-compose/media-abc123def456.mp4", bytes: 12345, sha256: "abc" },
    input: { videoDurationMs: 5031, audioDurationMs: 12640 },
    final: { durationMs: 5031, width: 480, height: 832, videoCodec: "h264", audioCodec: "aac", audioSampleRate: 48000, audioChannels: 2 },
    composition: { strategy: "shortest", videoCopied: true, videoReencoded: false, audioEncoded: true },
    timings: { probeInputMs: 10, composeMs: 100, probeOutputMs: 10, totalMs: 120 },
  },
  evidence: { evidenceId: "evidence-media-compose-result-media-compose-req1", capabilityId: "media.compose", agentId: "composer", succeeded: true, providerId: "ffmpeg", providerInvoked: true, workflowId: "wf1", correlationId: "corr1" },
};

describe("MediaAgent", () => {
  it("succeeds with matching FFmpeg evidence", async () => {
    const agent = agentWith(successExec);
    const out = await agent.execute({ input: { requestId: "req1", objective: "compose", video: "output/wan-latest.mp4", audio: "output/tts-benchmark/voicetut-short.wav", workflowId: "wf1", correlationId: "corr1" } }, { throwIfCancelled: () => {}, isCancelled: false });
    const payload = out.output;
    assert.equal(payload.status, "completed");
    assert.equal(payload.mediaId, "media-abc123def456");
    assert.equal(payload.executionEvidencePresent, true);
  });

  it("blocks when capability is blocked", async () => {
    const blocked = { status: "blocked", resultId: "r1", capabilityId: "media.compose", reason: "video file does not exist" };
    const agent = agentWith(blocked);
    const out = await agent.execute({ input: { requestId: "req1", objective: "compose", video: "output/missing.mp4", audio: "output/tts-benchmark/voicetut-short.wav", workflowId: "wf1", correlationId: "corr1" } }, { throwIfCancelled: () => {}, isCancelled: false });
    assert.equal(out.output.status, "blocked");
    assert.equal(out.output.executionEvidencePresent, false);
  });

  it("does not convert failed execution into success", async () => {
    const failed = { status: "failed", resultId: "r1", capabilityId: "media.compose", error: { code: "EXECUTION", message: "ffmpeg failed", retryable: false }, evidence: { evidenceId: "e1", capabilityId: "media.compose", agentId: "composer", succeeded: false } };
    const agent = agentWith(failed);
    const out = await agent.execute({ input: { requestId: "req1", objective: "compose", video: "output/wan-latest.mp4", audio: "output/tts-benchmark/voicetut-short.wav", workflowId: "wf1", correlationId: "corr1" } }, { throwIfCancelled: () => {}, isCancelled: false });
    assert.equal(out.output.status, "blocked");
  });

  it("throws on completely malformed input (missing video/audio)", async () => {
    const agent = agentWith(successExec);
    await assert.rejects(
      () => agent.execute({ input: { requestId: "req1", objective: "compose", video: "", audio: "" } }, { throwIfCancelled: () => {}, isCancelled: false }),
      /Invalid media input/,
    );
  });

  it("never invokes capability for malformed input that throws before runCapabilities", async () => {
    let invoked = false;
    const cap = { execute: async () => { invoked = true; return successExec; }, executeCapability: async () => { invoked = true; return successExec; } };
    const agent = agentWith(successExec, cap);
    try {
      await agent.execute({ input: { video: "x", audio: "y" } }, { throwIfCancelled: () => {}, isCancelled: false });
    } catch { /* expected throw */ }
    assert.equal(invoked, false);
  });
});
