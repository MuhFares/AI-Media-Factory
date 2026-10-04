import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ArtifactStorageReceipt,
  type DeleteObjectGuard,
  type ObjectStorageAdapter,
  type PutObjectRequest,
  type ReadTransportReference,
  type StoredObjectHead,
  SHA256_PATTERN,
  assertArtifactStorageIdentity,
  canonicalStorageKey,
} from "./contracts.js";

const TEST_ACK = "AMF_PROVIDER_FREE_LOCAL_DURABLE_BACKEND";
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

interface StoredMetadata {
  readonly receipt: ArtifactStorageReceipt;
}

export class LocalDurableObjectStorage implements ObjectStorageAdapter {
  readonly providerId = "local-durable-test";
  private readonly root: string;

  constructor(input: { root: string; testOnlyAcknowledgement: typeof TEST_ACK }) {
    if (input.testOnlyAcknowledgement !== TEST_ACK) throw new Error("LOCAL_STORAGE_TEST_ACK_REQUIRED");
    if (!path.isAbsolute(input.root)) throw new Error("LOCAL_STORAGE_ROOT_MUST_BE_ABSOLUTE");
    const normalized = path.resolve(input.root);
    if (["output", "artifacts", "storage"].includes(path.basename(normalized).toLowerCase())) throw new Error("LOCAL_STORAGE_NORMAL_OUTPUT_ROOT_FORBIDDEN");
    this.root = normalized;
  }

  async put(request: PutObjectRequest): Promise<ArtifactStorageReceipt> {
    assertArtifactStorageIdentity(request);
    const bytes = Buffer.from(request.bytesValue);
    if (bytes.byteLength !== request.bytes) throw new Error("STORAGE_BYTE_COUNT_MISMATCH");
    if (sha256(bytes) !== request.sha256) throw new Error("STORAGE_HASH_MISMATCH");
    const storageKey = request.storageKey ?? canonicalStorageKey(request);
    const paths = this.paths(storageKey);
    await mkdir(path.dirname(paths.object), { recursive: true });
    const existing = await this.head(storageKey);
    if (existing !== null) {
      if (existing.sha256 !== request.sha256 || existing.bytes !== request.bytes || existing.mimeType !== request.mimeType) throw new Error("STORAGE_KEY_CONFLICT");
      return this.receipt(request, storageKey, existing.verifiedAt);
    }
    const suffix = `${process.pid}-${Date.now()}`;
    const tempObject = `${paths.object}.${suffix}.tmp`;
    const tempMetadata = `${paths.metadata}.${suffix}.tmp`;
    const verifiedAt = new Date().toISOString();
    const receipt = this.receipt(request, storageKey, verifiedAt);
    await writeFile(tempObject, bytes, { flag: "wx" });
    await writeFile(tempMetadata, `${JSON.stringify({ receipt }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tempObject, paths.object);
    await rename(tempMetadata, paths.metadata);
    await this.get(storageKey, request.sha256);
    return receipt;
  }

  async head(storageKey: string): Promise<StoredObjectHead | null> {
    const paths = this.paths(storageKey);
    try {
      const metadata = JSON.parse(await readFile(paths.metadata, "utf8")) as StoredMetadata;
      const info = await stat(paths.object);
      const actual = sha256(await readFile(paths.object));
      const receipt = metadata.receipt;
      return {
        storageProvider: this.providerId,
        storageKey,
        sha256: receipt.sha256,
        bytes: info.size,
        mimeType: receipt.mimeType,
        durabilityStatus: actual === receipt.sha256 && info.size === receipt.bytes ? "VERIFIED" : "CORRUPT",
        verifiedAt: new Date().toISOString(),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async get(storageKey: string, expectedSha256: string): Promise<Uint8Array> {
    if (!SHA256_PATTERN.test(expectedSha256)) throw new Error("STORAGE_SHA256_INVALID");
    const head = await this.head(storageKey);
    if (head === null) throw new Error("STORAGE_OBJECT_NOT_FOUND");
    if (head.durabilityStatus !== "VERIFIED" || head.sha256 !== expectedSha256) throw new Error("STORAGE_CORRUPTION_DETECTED");
    return readFile(this.paths(storageKey).object);
  }

  async exists(storageKey: string): Promise<boolean> {
    return (await this.head(storageKey))?.durabilityStatus === "VERIFIED";
  }

  async delete(storageKey: string, guard: DeleteObjectGuard): Promise<void> {
    if (!guard.ownerAuthorized || !guard.retentionEligible || !guard.durableCopyVerified || !guard.lineagePersisted
      || guard.unresolvedRecoveryReferences !== 0 || guard.immutableEvidence) throw new Error("STORAGE_DELETE_NOT_AUTHORIZED");
    await this.get(storageKey, guard.expectedSha256);
    const paths = this.paths(storageKey);
    await rm(paths.object);
    await rm(paths.metadata);
  }

  async createReadReference(storageKey: string, expectedSha256: string): Promise<ReadTransportReference> {
    await this.get(storageKey, expectedSha256);
    return { type: "LOCAL_TEST_REFERENCE", reference: pathToFileURL(this.paths(storageKey).object).toString(), expiresAt: null, expectedSha256 };
  }

  private receipt(request: PutObjectRequest, storageKey: string, verifiedAt: string): ArtifactStorageReceipt {
    return { artifactId: request.artifactId, sha256: request.sha256, bytes: request.bytes, mimeType: request.mimeType,
      storageClass: request.storageClass, storageProvider: this.providerId, storageKey,
      localCachePath: request.localCachePath ?? null, sourceExecutionId: request.sourceExecutionId,
      projectId: request.projectId, contentId: request.contentId, createdAt: request.createdAt,
      retentionClass: request.retentionClass, durabilityStatus: "VERIFIED", verifiedAt,
      contentAddress: `sha256:${request.sha256}` };
  }

  private paths(storageKey: string): { object: string; metadata: string } {
    if (!storageKey.trim() || path.isAbsolute(storageKey) || storageKey.includes("..") || storageKey.includes("\\")) throw new Error("STORAGE_KEY_INVALID");
    const object = path.resolve(this.root, ...storageKey.split("/"));
    const relative = path.relative(this.root, object);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("STORAGE_KEY_ESCAPES_ROOT");
    return { object, metadata: `${object}.metadata.json` };
  }
}

export const LOCAL_DURABLE_TEST_ACKNOWLEDGEMENT = TEST_ACK;
