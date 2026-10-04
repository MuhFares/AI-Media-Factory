import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Persistent-worker build identity (R7 hardening).
 *
 * A deterministic fingerprint of the DEPLOYED dist artifacts that actually
 * execute media work. Pre-authorization compares the expected build (computed
 * in the operator process from the same checkout) against the running
 * persistent worker's startup build identity: any drift (e.g. a grant fix
 * built but not yet loaded by the worker) fails closed with
 * MEDIA_WORKER_BUILD_DRIFT before resume creation.
 *
 * Inputs are file paths + bytes only — never secrets, env, or config.
 */

export interface MediaBuildIdentity {
  readonly buildId: string;
  readonly files: readonly string[];
  readonly computedAt: string;
}

/** Dist roots whose bytes execute or govern media work. */
export const MEDIA_BUILD_PACKAGES: readonly string[] = [
  // The Node control plane and worker report one platform build identity.
  // Include API bytes so a changed route/contract cannot masquerade as
  // current merely because worker-only packages were unchanged.
  "apps/api",
  "apps/worker",
  "packages/provider-adapters",
  "packages/database",
  "packages/workflow-engine",
  "packages/tool-framework",
  "packages/research-agent",
  "packages/publisher-agent",
  "packages/shared",
];

export function workerRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function collectDistJs(distDir: string, base: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(distDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(distDir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      collectDistJs(full, base, out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(rel);
    }
  }
}

/** Deterministic build id over deployed dist bytes. Throws when dist is missing (fail closed: cannot certify). */
export function computeMediaBuildId(root: string = workerRepoRoot()): MediaBuildIdentity {
  const files: string[] = [];
  for (const pkg of MEDIA_BUILD_PACKAGES) {
    const dist = path.join(root, pkg, "dist");
    try {
      statSync(dist);
    } catch {
      throw new Error(`MEDIA_BUILD_DIST_MISSING:${pkg}/dist`);
    }
    const rel: string[] = [];
    collectDistJs(dist, root, rel);
    files.push(...rel);
  }
  files.sort();
  if (files.length === 0) throw new Error("MEDIA_BUILD_DIST_EMPTY");
  const digest = createHash("sha256");
  for (const rel of files) {
    digest.update(rel);
    digest.update("\0");
    digest.update(readFileSync(path.join(root, rel)));
    digest.update("\0");
  }
  return { buildId: digest.digest("hex"), files, computedAt: new Date().toISOString() };
}
