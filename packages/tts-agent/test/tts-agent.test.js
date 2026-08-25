/** TTS Agent tests — mocked capability execution, no real provider. */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createTTSAgent } from "../dist/index.js";

function makeAgent(capabilityExecution) {
  return createTTSAgent({
    execute: async () => {
      throw new Error("LLM should not be used by the TTS agent");
    },
    capabilityExecution,
    config: {
      model: "deterministic",
      maxTextLength: 2000,
      defaultLanguage: "ar",
      systemPrompt: "",
    },
  });
}

function makeInput(overrides = {}) {
  return {
    context: { turnId: "turn-1" },
    input: {
      requestId: "req-tts-1",
      objective: "Generate narration",
      text: "اليوم سنستكشف كيف يغيّر الذكاء الاصطناعي طريقة عمل الشركات.",
      language: "ar",
      workflowId: "wf-tts-test",
      correlationId: "corr-tts-test",
      ...overrides,
    },
  };
}

const noopSignal = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

function successExecution() {
  return {
    status: "success",
    resultId: "tts-generation-result-tts-req-tts-1",
    capabilityId: "tts.generate",
    output: {
      providerId: "groq",
      audioId: "groq-abc123",
      url: "data:audio/wav;base64," + "A".repeat(200),
      format: "wav",
      voice: "fahad",
      model: "canopylabs/orpheus-arabic-saudi",
    },
    evidence: {
      evidenceId: "evidence-tts-generation-result-tts-req-tts-1",
      capabilityId: "tts.generate",
      agentId: "tts",
      workflowId: "wf-tts-test",
      succeeded: true,
      providerInvoked: true,
      providerId: "groq",
    },
  };
}

test("tts agent produces a completed tts_report on capability success", async () => {
  const executed = [];
  const agent = makeAgent({
    executeCapability: async (request) => {
      executed.push(request);
      return successExecution();
    },
  });
  const out = await agent.execute(makeInput(), noopSignal);
  assert.equal(executed.length, 1, "capability must be requested exactly once");
  assert.equal(executed[0].capabilityId, "tts.generate");
  assert.equal(executed[0].agentId, "tts");
  assert.equal(executed[0].workflowId, "wf-tts-test");
  assert.equal(out.output.status, "completed");
  assert.equal(out.output.providerId, "groq");
  assert.equal(out.output.audioId, "groq-abc123");
  assert.equal(out.output.executionEvidencePresent, true);
  assert.ok(out.output.audioUrl.startsWith("data:audio/wav;base64,"));
  assert.ok(Array.isArray(out.output.capabilityExecutions));
});

test("tts agent blocks when capability execution is not configured", async () => {
  const agent = makeAgent(undefined);
  const out = await agent.execute(makeInput(), noopSignal);
  assert.equal(out.output.status, "blocked");
  assert.equal(out.output.audioId, "");
  assert.equal(out.output.executionEvidencePresent, false);
});

test("tts agent blocks on capability failure and never fabricates audio", async () => {
  const agent = makeAgent({
    executeCapability: async () => ({
      status: "failed",
      resultId: "r",
      capabilityId: "tts.generate",
      error: { code: "PROVIDER_ERROR", message: "boom", retryable: false },
      evidence: {
        evidenceId: "e",
        capabilityId: "tts.generate",
        agentId: "tts",
        succeeded: false,
        providerInvoked: true,
      },
    }),
  });
  const out = await agent.execute(makeInput(), noopSignal);
  assert.equal(out.output.status, "blocked");
  assert.equal(out.output.audioUrl, "");
  assert.equal(out.output.executionEvidencePresent, false);
});

test("tts agent blocks when evidence does not match the success claim (mismatch prevention)", async () => {
  const forged = successExecution();
  forged.evidence.succeeded = false; // success claimed but evidence says failed
  const agent = makeAgent({ executeCapability: async () => forged });
  const out = await agent.execute(makeInput(), noopSignal);
  assert.equal(out.output.status, "blocked", "evidence mismatch must block");
  assert.equal(out.output.audioUrl, "");
});

test("tts agent blocks when capability id in evidence does not match", async () => {
  const forged = successExecution();
  forged.evidence.capabilityId = "image.generate";
  const agent = makeAgent({ executeCapability: async () => forged });
  const out = await agent.execute(makeInput(), noopSignal);
  assert.equal(out.output.status, "blocked");
});

test("tts agent rejects empty text without calling the capability", async () => {
  let called = 0;
  const agent = makeAgent({
    executeCapability: async () => {
      called += 1;
      return successExecution();
    },
  });
  const out = await agent.execute(makeInput({ text: "   " }), noopSignal);
  assert.equal(out.output.status, "blocked");
  assert.equal(called, 0, "capability must not be invoked for empty text");
});

test("tts agent passes language/voice through to the capability request", async () => {
  const executed = [];
  const agent = makeAgent({
    executeCapability: async (request) => {
      executed.push(request);
      return successExecution();
    },
  });
  await agent.execute(makeInput({ voice: "lulwa", format: "wav" }), noopSignal);
  assert.equal(executed[0].input.voice, "lulwa");
  assert.equal(executed[0].input.format, "wav");
  assert.equal(executed[0].input.language, "ar");
});
