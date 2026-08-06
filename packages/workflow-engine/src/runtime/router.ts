/**
 * Default BranchRouter implementation.
 */

import type { StepId } from "../core/common.js";
import type { BranchStep } from "../model/step.js";
import type { WorkflowContext } from "../model/context.js";
import type { BranchRouter } from "../execution/router.js";
import type { Json } from "../core/common.js";

/** Evaluates a simple JSON predicate against context. */
function evaluatePredicate(predicate: unknown, context: WorkflowContext): boolean {
  if (typeof predicate !== "object" || predicate === null) {
    return Boolean(predicate);
  }

  const pred = predicate as Record<string, unknown>;
  const data = context.data as Record<string, Json>;

  for (const [key, expected] of Object.entries(pred)) {
    const actual = data[key];
    if (typeof expected === "object" && expected !== null) {
      // Support operators like $eq, $ne, $gt, $lt, $in, $contains
      const ops = expected as Record<string, unknown>;
      for (const [op, value] of Object.entries(ops)) {
        if (!compareValues(actual, op, value)) return false;
      }
    } else {
      // Simple equality
      if (!jsonEquals(actual, expected)) return false;
    }
  }
  return true;
}

function compareValues(actual: Json, op: string, value: unknown): boolean {
  switch (op) {
    case "$eq":
      return jsonEquals(actual, value);
    case "$ne":
      return !jsonEquals(actual, value);
    case "$gt":
      return compareNumbers(actual, value, (a, b) => a > b);
    case "$gte":
      return compareNumbers(actual, value, (a, b) => a >= b);
    case "$lt":
      return compareNumbers(actual, value, (a, b) => a < b);
    case "$lte":
      return compareNumbers(actual, value, (a, b) => a <= b);
    case "$in":
      return Array.isArray(value) && jsonEqualsArray(actual, value);
    case "$contains":
      return typeof actual === "string" && typeof value === "string" && actual.includes(value);
    default:
      return false;
  }
}

function jsonEquals(a: Json, b: unknown): boolean {
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      return a.length === (b as Json[]).length && a.every((v, i) => jsonEquals(v, (b as Json[])[i]));
    }
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    return keysA.length === keysB.length && keysA.every(k => jsonEquals((a as Record<string, Json>)[k], (b as Record<string, Json>)[k]));
  }
  return a === b;
}

function jsonEqualsArray(actual: Json, expected: unknown[]): boolean {
  if (!Array.isArray(actual)) return false;
  return actual.some(v => expected.some(e => jsonEquals(v, e)));
}

function compareNumbers(actual: Json, value: unknown, fn: (a: number, b: number) => boolean): boolean {
  if (typeof actual !== "number" || typeof value !== "number") return false;
  return fn(actual, value);
}

export class DefaultBranchRouter implements BranchRouter {
  choose(step: BranchStep, context: WorkflowContext): StepId {
    for (const { when, goto } of step.cases) {
      if (evaluatePredicate(when, context)) {
        return goto;
      }
    }
    return step.otherwise;
  }
}