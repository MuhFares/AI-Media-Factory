import { greet, type MediaJob } from "@ai-media-factory/shared";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8000";

const sampleJob: MediaJob = {
  id: "job-0001",
  kind: "image",
  status: "pending",
};

function main(): void {
  console.log(greet("AI Media Factory"));
  console.log(`API base URL: ${apiBaseUrl}`);
  console.log(`Sample job: ${sampleJob.id} (${sampleJob.status})`);
}

main();
