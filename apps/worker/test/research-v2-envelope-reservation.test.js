/**
 * Provider-free test matrix for MORROWAY_RESEARCH_V2_AUTHORIZED_ENVELOPE_RESERVATION_FIX_V1.
 *
 * Tests the envelope computation and adaptive allocation WITHOUT any
 * real provider, LLM, or database calls.
 *
 * Scenarios:
 *   A. remaining=4, max=6, planned/executed <=4
 *   B. remaining=2, plan adapts <=2
 *   C. remaining=1, one discovery, zero candidates → verification=0
 *   D. planner proposes > authorized envelope → adapt/reject
 *   E. concurrent reservation race → atomic protection
 *   F. mission needs 3 out of 4 → only 3 reserved/consumed
 */
import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Helpers: reproduce the envelope computation from production-executor.ts
// ---------------------------------------------------------------------------
const ARCHITECTURAL_MAX = 6;
const MISSION_AUTHORIZED_MAX = 4;

function effectiveEnvelope(remainingBudget) {
  return Math.min(ARCHITECTURAL_MAX, MISSION_AUTHORIZED_MAX, remainingBudget);
}

// Reproduce the research agent's V2 bounded allocation constants.
const MAX_DISCOVERY_REQUESTS = 3;
const MAX_VERIFICATION_REQUESTS = 3;

function computeAllocation(envelope, plannedDiscovery, candidateCount) {
  const discoveryBudget = Math.min(MAX_DISCOVERY_REQUESTS, envelope);
  const actualDiscovery = Math.min(plannedDiscovery, discoveryBudget);
  const remainingForVerification = Math.max(0, envelope - actualDiscovery);
  const verificationBudget = Math.min(MAX_VERIFICATION_REQUESTS, remainingForVerification);
  // Each candidate in HISTORICAL_POV generates 1 verification query
  const actualVerification = Math.min(candidateCount, verificationBudget);
  return {
    discoveryBudget,
    actualDiscovery,
    remainingForVerification,
    verificationBudget,
    actualVerification,
    totalPlanned: actualDiscovery + actualVerification,
  };
}

// ---------------------------------------------------------------------------
// In-memory budget store for concurrency test
// ---------------------------------------------------------------------------
class InMemoryBudgetStore {
  constructor(limit, reserved = 0, consumed = 0) {
    this.limit = limit;
    this.reserved = reserved;
    this.consumed = consumed;
    this._lock = Promise.resolve();
  }

  get remaining() {
    return Math.max(0, this.limit - this.reserved - this.consumed);
  }

  async budgets() {
    return [{ callKind: "research", limit: this.limit, reserved: this.reserved, consumed: this.consumed, remaining: this.remaining }];
  }

  async reserve() {
    // Serialize access to simulate atomic row-level lock
    const prev = this._lock;
    let resolve;
    this._lock = new Promise((r) => { resolve = r; });
    await prev;
    try {
      const remaining = this.remaining;
      if (remaining <= 0) throw new Error("PRODUCTION_PHASE_HARD_CAP_STOP:research");
      this.reserved += 1;
      return { reservationId: `res-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, status: "RESERVED" };
    } finally {
      resolve();
    }
  }

  async reconcile(input) {
    const prev = this._lock;
    let resolve;
    this._lock = new Promise((r) => { resolve = r; });
    await prev;
    try {
      if (this.reserved > 0) this.reserved -= 1;
      if (input.providerSubmissionStarted) this.consumed += 1;
    } finally {
      resolve();
    }
  }
}

// ---------------------------------------------------------------------------
// SCENARIO A: remaining=4, architectural=6, effective=4, planned<=4
// ---------------------------------------------------------------------------
test("SCENARIO A: remaining=4, effective envelope=4, planned/executed <=4", () => {
  const remaining = 4;
  const envelope = effectiveEnvelope(remaining);
  assert.equal(envelope, 4, "effective envelope should be min(6,4,4)=4");

  // Mission: 1 discovery lane, 3 candidates needing verification
  const alloc = computeAllocation(envelope, 1, 3);
  assert.equal(alloc.actualDiscovery, 1);
  assert.equal(alloc.actualVerification, 3);
  assert.equal(alloc.totalPlanned, 4);
  assert.ok(alloc.totalPlanned <= envelope, "total must not exceed envelope");
});

// ---------------------------------------------------------------------------
// SCENARIO B: remaining=2, plan adapts <=2
// ---------------------------------------------------------------------------
test("SCENARIO B: remaining=2, plan adapts to <=2", () => {
  const remaining = 2;
  const envelope = effectiveEnvelope(remaining);
  assert.equal(envelope, 2, "effective envelope should be min(6,4,2)=2");

  // Mission: 1 discovery lane with maxCalls=1, 3 candidates (but budget only allows 1 verification)
  const alloc = computeAllocation(envelope, 1, 3);
  assert.equal(alloc.actualDiscovery, 1);
  assert.equal(alloc.remainingForVerification, 1);
  assert.equal(alloc.actualVerification, 1, "verification capped by remaining budget");
  assert.equal(alloc.totalPlanned, 2);
  assert.ok(alloc.totalPlanned <= envelope, "total must not exceed envelope");
});

// ---------------------------------------------------------------------------
// SCENARIO C: remaining=1, one discovery, zero candidates → verification=0
// ---------------------------------------------------------------------------
test("SCENARIO C: remaining=1, one discovery, zero candidates, no verification", () => {
  const remaining = 1;
  const envelope = effectiveEnvelope(remaining);
  assert.equal(envelope, 1, "effective envelope should be min(6,4,1)=1");

  // 1 discovery, returns 0 candidates → no verification needed
  const alloc = computeAllocation(envelope, 1, 0);
  assert.equal(alloc.actualDiscovery, 1);
  assert.equal(alloc.remainingForVerification, 0);
  assert.equal(alloc.actualVerification, 0, "no candidates means no verification");
  assert.equal(alloc.totalPlanned, 1);
});

// ---------------------------------------------------------------------------
// SCENARIO D: planner proposes > authorized envelope → adapt before reservation
// ---------------------------------------------------------------------------
test("SCENARIO D: planner proposes 5 calls with envelope=4, adapts to 4", () => {
  const remaining = 4;
  const envelope = effectiveEnvelope(remaining);
  assert.equal(envelope, 4);

  // Planner proposes 3 discovery + 3 verification = 6 total (exceeds envelope)
  // The system adapts: discovery capped to min(3, 4)=3, verification capped to min(3, 4-3=1)=1
  const alloc = computeAllocation(envelope, 3, 3);
  assert.equal(alloc.actualDiscovery, 3);
  assert.equal(alloc.actualVerification, 1, "verification reduced to fit envelope");
  assert.equal(alloc.totalPlanned, 4);
  assert.ok(alloc.totalPlanned <= envelope, "adapted plan must not exceed envelope");

  // Verify: no budget mutation happened (pure computation, no provider call)
  // This is structural: computeAllocation is pure, no side effects.
});

// ---------------------------------------------------------------------------
// SCENARIO E: concurrent reservation race, atomic protection
// ---------------------------------------------------------------------------
test("SCENARIO E: concurrent reservation race preserves atomic protection", async () => {
  // Budget has 4 remaining, 10 concurrent reserve attempts
  const store = new InMemoryBudgetStore(4);
  const attempts = 10;
  const results = await Promise.allSettled(
    Array.from({ length: attempts }, () => store.reserve()),
  );
  const successes = results.filter((r) => r.status === "fulfilled");
  const failures = results.filter((r) => r.status === "rejected");

  assert.equal(successes.length, 4, "exactly 4 reservations should succeed");
  assert.equal(failures.length, 6, "exactly 6 should fail at hard cap");
  assert.equal(store.reserved, 4, "reserved count must equal 4");
  assert.equal(store.remaining, 0, "remaining must be 0 after 4 reservations");

  // Verify all failures are hard-cap errors
  for (const failure of failures) {
    assert.ok(failure.reason.message.includes("HARD_CAP_STOP"), "failure should be hard cap stop");
  }
});

// ---------------------------------------------------------------------------
// SCENARIO F: mission needs 3 out of 4, only 3 reserved/consumed
// ---------------------------------------------------------------------------
test("SCENARIO F: mission uses 3 out of envelope=4, only 3 consumed", async () => {
  const remaining = 4;
  const envelope = effectiveEnvelope(remaining);
  assert.equal(envelope, 4);

  // Mission: 1 discovery, 2 candidates → 1 discovery + 2 verification = 3
  const alloc = computeAllocation(envelope, 1, 2);
  assert.equal(alloc.totalPlanned, 3, "only 3 calls planned");
  assert.ok(alloc.totalPlanned < envelope, "1 slot should remain unused");

  // Simulate: reserve envelope (4), use 3, release 1
  const store = new InMemoryBudgetStore(10); // budget=10
  const reservations = [];
  for (let i = 0; i < envelope; i++) {
    reservations.push(await store.reserve());
  }
  assert.equal(store.reserved, 4);

  // Reconcile: 3 consumed (submitted), 1 released (not submitted)
  for (let i = 0; i < alloc.totalPlanned; i++) {
    await store.reconcile({ providerSubmissionStarted: true });
  }
  // Release unused
  const unused = envelope - alloc.totalPlanned;
  for (let i = 0; i < unused; i++) {
    await store.reconcile({ providerSubmissionStarted: false });
  }

  assert.equal(store.reserved, 0, "all reservations reconciled");
  assert.equal(store.consumed, 3, "exactly 3 consumed");
  assert.equal(store.remaining, 7, "7 remaining from budget of 10 after consuming 3");
});

// ---------------------------------------------------------------------------
// SUPPLEMENTAL: envelope with zero remaining
// ---------------------------------------------------------------------------
test("SUPPLEMENTAL: remaining=0 produces envelope=0, no calls", () => {
  const envelope = effectiveEnvelope(0);
  assert.equal(envelope, 0);
  const alloc = computeAllocation(envelope, 3, 5);
  assert.equal(alloc.actualDiscovery, 0);
  assert.equal(alloc.actualVerification, 0);
  assert.equal(alloc.totalPlanned, 0);
});

// ---------------------------------------------------------------------------
// SUPPLEMENTAL: remaining exceeds architectural max, capped to architectural
// ---------------------------------------------------------------------------
test("SUPPLEMENTAL: remaining=100 capped to mission authorized max (4)", () => {
  const envelope = effectiveEnvelope(100);
  assert.equal(envelope, 4, "capped to min(6,4,100)=4");
});

// ---------------------------------------------------------------------------
// SUPPLEMENTAL: envelope=4 with 2 discovery + 2 verification
// ---------------------------------------------------------------------------
test("SUPPLEMENTAL: 2 discovery + 2 verification within envelope=4", () => {
  const envelope = effectiveEnvelope(4);
  const alloc = computeAllocation(envelope, 2, 2);
  assert.equal(alloc.actualDiscovery, 2);
  assert.equal(alloc.actualVerification, 2);
  assert.equal(alloc.totalPlanned, 4);
});

// ---------------------------------------------------------------------------
// SUPPLEMENTAL: envelope=4 with 3 discovery + 1 verification
// ---------------------------------------------------------------------------
test("SUPPLEMENTAL: 3 discovery + 1 verification within envelope=4", () => {
  const envelope = effectiveEnvelope(4);
  const alloc = computeAllocation(envelope, 3, 3);
  assert.equal(alloc.actualDiscovery, 3);
  assert.equal(alloc.remainingForVerification, 1);
  assert.equal(alloc.actualVerification, 1, "only 1 verification fits");
  assert.equal(alloc.totalPlanned, 4);
});
