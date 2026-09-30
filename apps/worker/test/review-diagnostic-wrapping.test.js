import test from "node:test";
import assert from "node:assert/strict";
import { safeValidationDiagnostics } from "../dist/production-executor.js";

const structured = () => Object.assign(new Error("safe structural failure"), {
  diagnostics: { validationStage: "structural", validationCode: "REVIEW_STRUCTURAL_INVALID_REPORT", issueCount: 1, issuePaths: ["$"], issueCodes: ["INVALID_REPORT"] },
});

test("direct Review diagnostics remain bounded", () => {
  assert.deepEqual(safeValidationDiagnostics(structured()), structured().diagnostics);
});

test("Review diagnostics survive one Error.cause wrapper", () => {
  assert.equal(safeValidationDiagnostics(new Error("outer", { cause: structured() })).validationStage, "structural");
});

test("Review diagnostics survive multiple Error.cause wrappers", () => {
  const inner = structured();
  const wrapped = new Error("third", { cause: new Error("second", { cause: new Error("first", { cause: inner }) }) });
  assert.deepEqual(safeValidationDiagnostics(wrapped), inner.diagnostics);
});

test("generic runtime errors do not invent Review validation diagnostics", () => {
  assert.deepEqual(safeValidationDiagnostics(new Error("runtime stopped")), {});
});
