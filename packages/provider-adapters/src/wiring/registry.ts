/**
 * Provider capability registry wiring.
 *
 * Defines the five provider-backed capability descriptors and the exact
 * deny-by-default grants: each agent may only invoke its own vertical.
 */

import {
  ANALYTICS_CAPABILITY_ID,
  IMAGE_GENERATION_CAPABILITY_ID,
  PUBLISH_CAPABILITY_ID,
  TTS_GENERATION_CAPABILITY_ID,
  VIDEO_GENERATION_CAPABILITY_ID,
  WEB_SEARCH_CAPABILITY_ID,
} from "@ai-media-factory/tool-framework";
import type { CapabilityDescriptor, CapabilityGrant, JsonSchema } from "@ai-media-factory/tool-framework";

const text = (maxLength: number): JsonSchema => ({ type: "string", maxLength });
const positiveInt = (maximum?: number): JsonSchema =>
  maximum === undefined ? { type: "integer", minimum: 1 } : { type: "integer", minimum: 1, maximum };

export const PROVIDER_CAPABILITIES: readonly CapabilityDescriptor[] = [
  {
    capabilityId: WEB_SEARCH_CAPABILITY_ID,
    description:
      "Perform a web search and return the top results with title, url, snippet, source and rank. Provider-backed (Brave or Tavily).",
    inputSchema: {
      type: "object",
      properties: {
        query: text(200),
        maxResults: positiveInt(20),
        allowedDomains: { type: "array", items: { type: "string", format: "hostname" } },
      },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        providerId: { type: "string" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              url: { type: "string", format: "uri" },
              snippet: { type: "string" },
              source: { type: "string" },
              rank: { type: "integer", minimum: 1 },
            },
            required: ["title", "url", "snippet", "source", "rank"],
          },
        },
      },
      required: ["query", "providerId", "results"],
    },
  },
  {
    capabilityId: IMAGE_GENERATION_CAPABILITY_ID,
    description:
      "Generate an image from a text prompt and return the provider-confirmed image id, title and url. Provider-backed (OpenAI Images).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: text(1000),
        negativePrompt: text(1000),
        width: positiveInt(2048),
        height: positiveInt(2048),
        aspectRatio: { type: "string", enum: ["16:9", "9:16", "4:3", "3:4", "1:1"] },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string" },
        imageId: { type: "string" },
        title: { type: "string" },
        url: { type: "string", format: "uri" },
      },
      required: ["providerId", "imageId", "title", "url"],
    },
  },
  {
    capabilityId: VIDEO_GENERATION_CAPABILITY_ID,
    description:
      "Generate a video from a text prompt. Completion is only reported when the provider confirms a renderable video. Provider-backed (Replicate).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: text(1000),
        negativePrompt: text(1000),
        durationSeconds: positiveInt(600),
        aspectRatio: { type: "string", enum: ["16:9", "9:16", "4:3", "3:4", "1:1"] },
        sourceAssetIds: { type: "array", items: { type: "string" } },
        model: { type: "string" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string" },
        status: { type: "string", enum: ["submitted", "running", "completed", "failed"] },
        jobId: { type: "string" },
        videoId: { type: "string" },
        url: { type: "string", format: "uri" },
      },
      required: ["providerId", "status"],
    },
  },
  {
    capabilityId: PUBLISH_CAPABILITY_ID,
    description:
      "Publish an asset to YouTube and return the provider-confirmed publication id and url. Idempotent: the same logical request never creates a duplicate publication. Provider-backed (YouTube Data API v3).",
    inputSchema: {
      type: "object",
      properties: {
        assetId: text(500),
        title: text(200),
        description: text(1000),
        tags: { type: "array", items: text(30), maxItems: 30 },
        options: {
          type: "object",
          properties: {
            visibility: { type: "string", enum: ["public", "unlisted", "private"] },
          },
        },
      },
      required: ["assetId", "title"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string" },
        status: { type: "string", enum: ["pending", "completed", "failed"] },
        publicationId: { type: "string" },
        url: { type: "string", format: "uri" },
        publishedAt: { type: "string" },
        idempotencyKey: { type: "string" },
        deduplicated: { type: "boolean" },
      },
      required: ["providerId", "status", "idempotencyKey", "deduplicated"],
    },
  },
  {
    capabilityId: TTS_GENERATION_CAPABILITY_ID,
    description:
      "Synthesize narration audio from text and return a provider-confirmed data URL. Provider-backed (Groq Orpheus).",
    inputSchema: {
      type: "object",
      properties: {
        text: text(2000),
        language: text(16),
        voice: text(64),
        format: { type: "string", enum: ["wav", "mp3"] },
        speed: { type: "number", exclusiveMinimum: 0 },
      },
      required: ["text"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string" },
        audioId: { type: "string" },
        url: { type: "string" },
        format: { type: "string", enum: ["wav", "mp3"] },
        voice: { type: "string" },
        model: { type: "string" },
        durationSeconds: { type: "number" },
      },
      required: ["providerId", "audioId", "url", "format"],
    },
  },
  {
    capabilityId: ANALYTICS_CAPABILITY_ID,
    description:
      "Fetch analytics for a published video and return the provider-confirmed metrics. Never fabricates metrics. Provider-backed (YouTube Analytics API v2).",
    inputSchema: {
      type: "object",
      properties: {
        publicationId: text(200),
        platform: { type: "string" },
      },
      required: ["publicationId", "platform"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        providerId: { type: "string" },
        status: { type: "string", enum: ["completed", "failed"] },
        publicationId: { type: "string" },
        metrics: { type: "object", additionalProperties: { type: "number" } },
        retrievedAt: { type: "string" },
      },
      required: ["providerId", "status", "publicationId", "metrics", "retrievedAt"],
    },
  },
];

export const DEFAULT_PROVIDER_GRANTS: readonly CapabilityGrant[] = [
  { agentId: "research", capabilityIds: [WEB_SEARCH_CAPABILITY_ID] },
  { agentId: "thumbnail", capabilityIds: [IMAGE_GENERATION_CAPABILITY_ID] },
  { agentId: "video", capabilityIds: [VIDEO_GENERATION_CAPABILITY_ID] },
  { agentId: "publisher", capabilityIds: [PUBLISH_CAPABILITY_ID] },
  { agentId: "analytics", capabilityIds: [ANALYTICS_CAPABILITY_ID] },
  { agentId: "tts", capabilityIds: [TTS_GENERATION_CAPABILITY_ID] },
];