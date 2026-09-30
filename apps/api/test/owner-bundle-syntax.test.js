/**
 * Owner bundle parse-time regression guard.
 *
 * This intentionally invokes the same runtime parser used by the controlled
 * deployment. A malformed app.js must fail the ordinary apps/api test path,
 * before a build can be accepted or restarted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const bundle = path.join(REPO, "apps/api/src/ai_media_factory/static/app.js");

test("actual Owner app.js parses with Node", () => {
  const checked = spawnSync(process.execPath, ["--check", bundle], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout || "node --check failed");
});
