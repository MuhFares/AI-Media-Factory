import { test } from "node:test";
import assert from "node:assert/strict";
import { add } from "../src/math.js";

test("add returns the sum of two positive numbers", () => {
  assert.equal(add(2, 3), 5);
});

test("add handles negative numbers", () => {
  assert.equal(add(-1, 1), 0);
});

test("add handles zero", () => {
  assert.equal(add(0, 0), 0);
});
