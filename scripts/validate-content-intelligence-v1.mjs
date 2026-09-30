import { ingestLocalReferenceVideo } from "../packages/research-agent/dist/index.js";
const root = "D:/AIWorkspace/AI-Media-Factory";
const result = await ingestLocalReferenceVideo({
  projectRoot: root,
  filePath: `${root}/output/manual-external-generation-v1/wan-i2v-gate/wan-i2v-runpod-9fbc118a.mp4`,
  outputDirectory: `${root}/output/content-intelligence-reference-ingestion-v1/local-video`,
});
console.log(JSON.stringify(result, null, 2));
