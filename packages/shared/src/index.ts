/** Shared types and utilities for AI Media Factory. */

export type MediaKind = "image" | "audio" | "video";

export type JobStatus = "pending" | "processing" | "done" | "failed";

export interface MediaJob {
  id: string;
  kind: MediaKind;
  status: JobStatus;
}

/** Return a friendly greeting used across apps. */
export function greet(name: string): string {
  return `Hello from ${name}!`;
}
