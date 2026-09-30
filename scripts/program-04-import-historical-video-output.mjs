#!/usr/bin/env node
import ffprobeStatic from "ffprobe-static";
import {
  AUDITED_VIDEO_OUTPUT_IMPORT_CONFIRMATION,
  AuditedVideoOutputImportStore,
  OWNER_ATTESTED_PROVIDER_PROOF,
  createPool,
  inspectLocalMp4,
} from "@ai-media-factory/database";

const args = new Map(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.split("=");
  return [key, rest.join("=")];
}));
const value = (name) => args.get(`--${name}`)?.trim() ?? "";
if (!args.has("--apply") || value("confirm-production") !== AUDITED_VIDEO_OUTPUT_IMPORT_CONFIRMATION) {
  throw new Error(`PRODUCTION_IMPORT_CONFIRMATION_REQUIRED:--apply --confirm-production=${AUDITED_VIDEO_OUTPUT_IMPORT_CONFIRMATION}`);
}
if (value("acknowledge-ambiguity") !== OWNER_ATTESTED_PROVIDER_PROOF) {
  throw new Error(`AMBIGUITY_ACKNOWLEDGEMENT_REQUIRED:${OWNER_ATTESTED_PROVIDER_PROOF}`);
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const input = {
  videoExecutionId: value("video-execution-id"),
  filePath: value("mp4-path"),
  expectedProjectId: value("project-id"),
  expectedContentId: value("content-id"),
  expectedWorkflowId: value("workflow-id"),
  expectedSceneId: value("scene-id"),
  expectedSourceVisualArtifactId: value("source-visual-artifact-id"),
  expectedSourceVisualSha256: value("source-visual-sha256"),
  ownerSuppliedProviderJobId: value("provider-job-id"),
  ownerAuthorizationRef: value("owner-authorization-ref"),
  ambiguityAcknowledgement: OWNER_ATTESTED_PROVIDER_PROOF,
};

const pool = createPool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const store = new AuditedVideoOutputImportStore(pool, (path) => inspectLocalMp4(path, ffprobeStatic.path));
  const result = await store.import(input);
  console.log(JSON.stringify({
    migration: "NONE",
    providerCalls: 0,
    videoBudgetAdditionalConsumption: 0,
    ...result,
  }, null, 2));
} finally {
  await pool.end();
}
