import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { sha256Canonical } from "./publication-validation.js";

export type MediaTransportRef =
  | { readonly type: "LOCAL_FILE"; readonly path: string; readonly expectedSha256: string; readonly mimeType?: string; readonly expectedByteCount?: number }
  | { readonly type: "HTTPS_URL"; readonly url: string; readonly expectedSha256: string; readonly mimeType?: string }
  | { readonly type: "PROVIDER_MATERIALIZED"; readonly providerId: string; readonly reference: string; readonly expectedSha256: string; readonly mimeType?: string };

export interface MediaTransportPreflight {
  readonly status: "PASS";
  readonly type: MediaTransportRef["type"];
  readonly fingerprint: string;
  readonly sha256: string;
  readonly byteCount: number | null;
  readonly resolvedReference: string;
}

const SHA256 = /^[a-f0-9]{64}$/i;

/** A path-independent transport fingerprint. Locations may change; bytes may not. */
export function mediaTransportFingerprint(ref: MediaTransportRef): string {
  return sha256Canonical({ type: ref.type, sha256: ref.expectedSha256.toLowerCase(), mimeType: ref.mimeType ?? null });
}

export async function preflightMediaTransport(ref: MediaTransportRef, canonicalSha256: string): Promise<MediaTransportPreflight> {
  if (!SHA256.test(canonicalSha256) || !SHA256.test(ref.expectedSha256) || ref.expectedSha256.toLowerCase() !== canonicalSha256.toLowerCase()) {
    throw new Error("MEDIA_TRANSPORT_SHA256_MISMATCH");
  }
  const fingerprint = mediaTransportFingerprint(ref);
  if (ref.type === "LOCAL_FILE") {
    if (!isAbsolute(ref.path)) throw new Error("MEDIA_TRANSPORT_LOCAL_PATH_MUST_BE_ABSOLUTE");
    let resolved: string;
    let info;
    let bytes: Buffer;
    try {
      resolved = await realpath(ref.path);
      info = await stat(resolved);
      bytes = await readFile(resolved);
    } catch {
      throw new Error("MEDIA_TRANSPORT_LOCAL_FILE_UNAVAILABLE");
    }
    if (!info.isFile() || info.size <= 0 || bytes.byteLength <= 0) throw new Error("MEDIA_TRANSPORT_LOCAL_FILE_INVALID");
    if (ref.expectedByteCount !== undefined && ref.expectedByteCount !== bytes.byteLength) throw new Error("MEDIA_TRANSPORT_BYTE_COUNT_MISMATCH");
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== canonicalSha256.toLowerCase()) throw new Error("MEDIA_TRANSPORT_SHA256_MISMATCH");
    return { status: "PASS", type: ref.type, fingerprint, sha256: actual, byteCount: bytes.byteLength, resolvedReference: resolved };
  }
  if (ref.type === "HTTPS_URL") {
    let url: URL;
    try { url = new URL(ref.url); } catch { throw new Error("MEDIA_TRANSPORT_HTTPS_URL_INVALID"); }
    if (url.protocol !== "https:") throw new Error("MEDIA_TRANSPORT_HTTPS_REQUIRED");
    return { status: "PASS", type: ref.type, fingerprint, sha256: canonicalSha256.toLowerCase(), byteCount: null, resolvedReference: url.toString() };
  }
  if (!ref.providerId.trim() || !ref.reference.trim()) throw new Error("MEDIA_TRANSPORT_PROVIDER_REFERENCE_INVALID");
  return { status: "PASS", type: ref.type, fingerprint, sha256: canonicalSha256.toLowerCase(), byteCount: null, resolvedReference: ref.reference };
}

/** Read and re-verify owned local bytes at the provider boundary (TOCTOU guard). */
export async function readVerifiedLocalMedia(ref: Extract<MediaTransportRef, { type: "LOCAL_FILE" }>, canonicalSha256: string): Promise<Uint8Array> {
  await preflightMediaTransport(ref, canonicalSha256);
  const bytes = await readFile(await realpath(ref.path));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== canonicalSha256.toLowerCase()) throw new Error("MEDIA_TRANSPORT_SHA256_MISMATCH");
  return bytes;
}
