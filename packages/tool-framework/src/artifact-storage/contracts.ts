export const STORAGE_CLASSES = [
  "EPHEMERAL_WORK",
  "CANONICAL_DURABLE",
  "HISTORICAL_EVIDENCE",
  "PUBLISHED_MEDIA",
  "REGENERABLE_CACHE",
] as const;

export type StorageClass = (typeof STORAGE_CLASSES)[number];
export type DurabilityStatus = "PENDING" | "VERIFIED" | "CORRUPT" | "MISSING";
export type RetentionClass =
  | "DELETE_AFTER_24_HOURS"
  | "DELETE_AFTER_7_DAYS"
  | "DELETE_AFTER_30_DAYS"
  | "DELETE_AFTER_90_DAYS"
  | "KEEP_1_YEAR"
  | "KEEP_WHILE_REFERENCED"
  | "KEEP_PUBLICATION_PLUS_7_YEARS"
  | "KEEP_7_YEARS"
  | "IMMUTABLE_EVIDENCE";

export interface ArtifactStorageIdentity {
  readonly artifactId: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly storageClass: StorageClass;
  readonly sourceExecutionId: string;
  readonly projectId: string;
  readonly contentId: string | null;
  readonly createdAt: string;
  readonly retentionClass: RetentionClass;
}

export interface ArtifactStorageReceipt extends ArtifactStorageIdentity {
  readonly storageProvider: string;
  readonly storageKey: string;
  readonly localCachePath: string | null;
  readonly durabilityStatus: DurabilityStatus;
  readonly verifiedAt: string;
  readonly contentAddress: string;
}

export interface PutObjectRequest extends ArtifactStorageIdentity {
  readonly bytesValue: Uint8Array;
  readonly storageKey?: string;
  readonly localCachePath?: string | null;
}

export interface StoredObjectHead {
  readonly storageProvider: string;
  readonly storageKey: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly durabilityStatus: DurabilityStatus;
  readonly verifiedAt: string;
}

export interface ReadTransportReference {
  readonly type: "LOCAL_TEST_REFERENCE" | "SIGNED_HTTPS" | "PROVIDER_REFERENCE";
  readonly reference: string;
  readonly expiresAt: string | null;
  readonly expectedSha256: string;
}

export interface DeleteObjectGuard {
  readonly ownerAuthorized: boolean;
  readonly retentionEligible: boolean;
  readonly durableCopyVerified: boolean;
  readonly lineagePersisted: boolean;
  readonly unresolvedRecoveryReferences: number;
  readonly immutableEvidence: boolean;
  readonly expectedSha256: string;
}

export interface ObjectStorageAdapter {
  readonly providerId: string;
  put(request: PutObjectRequest): Promise<ArtifactStorageReceipt>;
  head(storageKey: string): Promise<StoredObjectHead | null>;
  get(storageKey: string, expectedSha256: string): Promise<Uint8Array>;
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string, guard: DeleteObjectGuard): Promise<void>;
  createReadReference(storageKey: string, expectedSha256: string): Promise<ReadTransportReference>;
}

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function assertArtifactStorageIdentity(identity: ArtifactStorageIdentity): void {
  if (!identity.artifactId.trim() || !identity.projectId.trim() || !identity.sourceExecutionId.trim()) throw new Error("STORAGE_IDENTITY_REQUIRED");
  if (!SHA256_PATTERN.test(identity.sha256)) throw new Error("STORAGE_SHA256_INVALID");
  if (!Number.isSafeInteger(identity.bytes) || identity.bytes <= 0) throw new Error("STORAGE_BYTES_INVALID");
  if (!identity.mimeType.trim() || !STORAGE_CLASSES.includes(identity.storageClass)) throw new Error("STORAGE_CLASS_OR_MIME_INVALID");
  if (!Number.isFinite(Date.parse(identity.createdAt))) throw new Error("STORAGE_CREATED_AT_INVALID");
}

export function canonicalStorageKey(identity: ArtifactStorageIdentity): string {
  assertArtifactStorageIdentity(identity);
  return `${identity.projectId}/${identity.sha256.slice(0, 2)}/${identity.sha256}`;
}
