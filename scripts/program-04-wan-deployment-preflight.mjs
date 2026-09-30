#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const manifestPath = resolve(root, "configs/media/program-04-wan-hardening-deployment.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const managementKey = process.env[manifest.managementCredentialEnvironmentKey]?.trim();
const networkVolumeId = process.env[manifest.receiptStorage.networkVolumeIdEnvironmentKey]?.trim();
const imageDigest = process.env[manifest.immutableImageDigestEnvironmentKey]?.trim();
const failures = [];
if (!managementKey) failures.push("RUNPOD_MANAGEMENT_API_KEY_MISSING");
if (!networkVolumeId) failures.push("RUNPOD_VIDEO_NETWORK_VOLUME_ID_MISSING");
if (!imageDigest || !/^sha256:[a-f0-9]{64}$/iu.test(imageDigest)) failures.push("RUNPOD_VIDEO_HANDLER_IMAGE_DIGEST_MISSING_OR_INVALID");
if (manifest.receiptStorage.mountPath !== "/runpod-volume" || !manifest.receiptStorage.receiptDirectory.startsWith("/runpod-volume/")) failures.push("PERSISTENT_RECEIPT_PATH_INVALID");
if (manifest.runtime.model !== "wan2.2" || manifest.runtime.width !== 480 || manifest.runtime.height !== 832 || manifest.runtime.frames !== 81 || manifest.runtime.steps !== 10 || manifest.runtime.cfg !== 2) failures.push("FROZEN_GENERATION_CONFIG_DRIFT");

console.log(JSON.stringify({
  deploymentId: manifest.deploymentId,
  endpointId: manifest.endpointId,
  imageRepository: manifest.imageRepository,
  imageDigestConfigured: Boolean(imageDigest),
  networkVolumeConfigured: Boolean(networkVolumeId),
  receiptDirectory: manifest.receiptStorage.receiptDirectory,
  managementCredentialConfigured: Boolean(managementKey),
  generationRequestSent: false,
  readyForGuardedDeployment: failures.length === 0,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 42;
