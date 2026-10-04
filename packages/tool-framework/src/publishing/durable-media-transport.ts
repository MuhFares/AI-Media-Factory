import { fileURLToPath } from "node:url";
import type { ArtifactStorageReceipt, ObjectStorageAdapter } from "../artifact-storage/contracts.js";
import type { MediaTransportRef } from "./media-transport.js";

const DURABLE_PUBLICATION_CLASSES: ReadonlySet<string> = new Set([
  "CANONICAL_DURABLE",
  "HISTORICAL_EVIDENCE",
  "PUBLISHED_MEDIA",
]);

export interface DurablePublicationMedia {
  readonly artifactId: string;
  readonly sha256: string;
  readonly byteCount: number;
  readonly mimeType: string;
  readonly storageReceipt: ArtifactStorageReceipt;
}

/**
 * Resolve transport only after artifact identity, durable receipt and live
 * storage metadata agree. The storage location is never artifact identity.
 */
export async function resolveDurablePublicationTransport(
  media: DurablePublicationMedia,
  storage: ObjectStorageAdapter,
): Promise<MediaTransportRef> {
  const receipt = media.storageReceipt;
  if (receipt.artifactId !== media.artifactId || receipt.sha256 !== media.sha256 || receipt.bytes !== media.byteCount || receipt.mimeType !== media.mimeType) {
    throw new Error("PUBLICATION_STORAGE_IDENTITY_MISMATCH");
  }
  if (!DURABLE_PUBLICATION_CLASSES.has(receipt.storageClass)) {
    throw new Error("PUBLICATION_STORAGE_CLASS_NOT_DURABLE");
  }
  if (receipt.durabilityStatus !== "VERIFIED" || receipt.storageProvider !== storage.providerId) throw new Error("PUBLICATION_STORAGE_NOT_VERIFIED");
  const head = await storage.head(receipt.storageKey);
  if (head === null || head.durabilityStatus !== "VERIFIED" || head.sha256 !== media.sha256 || head.bytes !== media.byteCount) {
    throw new Error("PUBLICATION_STORAGE_HEAD_MISMATCH");
  }
  const reference = await storage.createReadReference(receipt.storageKey, media.sha256);
  if (reference.type === "LOCAL_TEST_REFERENCE") {
    return { type: "LOCAL_FILE", path: fileURLToPath(reference.reference), expectedSha256: media.sha256, expectedByteCount: media.byteCount, mimeType: media.mimeType };
  }
  if (reference.type === "SIGNED_HTTPS") {
    return { type: "HTTPS_URL", url: reference.reference, expectedSha256: media.sha256, mimeType: media.mimeType };
  }
  return { type: "PROVIDER_MATERIALIZED", providerId: storage.providerId, reference: reference.reference, expectedSha256: media.sha256, mimeType: media.mimeType };
}
