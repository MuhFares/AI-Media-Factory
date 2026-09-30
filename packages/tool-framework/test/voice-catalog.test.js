import assert from "node:assert/strict";
import test from "node:test";
import { selectVoice } from "../dist/tts/voice-catalog.js";

const records = [
  { provider: "groq", providerVoiceId: "hannah", model: "canopylabs/orpheus-v1-english", language: "en", isAvailable: "YES", automationEligible: true, productionStatus: "UNTESTED", metadataConfidence: "OFFICIAL_DOCUMENTATION", evidence: [] },
  { provider: "groq", providerVoiceId: "troy", model: "canopylabs/orpheus-v1-english", language: "en", isAvailable: "YES", automationEligible: true, productionStatus: "TECHNICALLY_TESTED", metadataConfidence: "PROJECT_VERIFIED", evidence: [] },
];
test("voice selection enforces provider/model and exclusion", () => assert.equal(selectVoice(records, { provider: "groq", model: "canopylabs/orpheus-v1-english", language: "en", excludeVoiceIds: ["troy"] })?.providerVoiceId, "hannah"));
test("unknown availability cannot be selected", () => assert.equal(selectVoice([{ ...records[0], isAvailable: "UNKNOWN" }], { provider: "groq", language: "en" }), undefined));
test("required gender cannot be inferred from a name", () => assert.equal(selectVoice([{ ...records[0], gender: undefined }], { provider: "groq", language: "en", requiredGender: "FEMALE" }), undefined));
