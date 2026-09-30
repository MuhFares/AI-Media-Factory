/**
 * Slice 5 remediation V2 — intent-aware response contracts for governed research.
 *
 * Root cause: the governed Research Agent always rendered through one fixed
 * content-research contract (concept/historicalAngle/sourceability/...) selected
 * by agent identity alone. An INTERNAL_PROJECT_ANALYSIS request ("three most
 * important things I should know as the Owner") therefore completed
 * technically while missing the requested analytical intent.
 *
 * Principle (general, never prompt-specific):
 *   AGENT + INTENT/TASK CLASS + AVAILABLE EVIDENCE -> RESPONSE CONTRACT
 *
 * This module is pure and deterministic: intent classification (keyword
 * rules, no LLM), contract definitions, validators, cardinality handling,
 * and artifact-section builders. No network, no secrets, no mutation.
 */

export type ResearchIntent = "INTERNAL_PROJECT_ANALYSIS" | "CONTENT_RESEARCH";

export type ResearchContractId = "INTERNAL_ANALYSIS_V1" | "INTERNAL_ANALYSIS_V2" | "CONTENT_RESEARCH_V1";

export interface ResearchContract {
  readonly id: ResearchContractId;
  readonly intent: ResearchIntent;
  /** Compact JSON appended to the role contract (bounded, no evidence dump). */
  readonly promptAppendix: string;
  /** Worst-case valid payload bytes (measured schema ceiling, not a guess). */
  readonly worstCaseBytes: number;
  readonly externalResearchRequired: boolean;
  readonly grantsAuthority: false;
}

/** Explicit external-research signals. Absent => internal evidence suffices. */
const EXTERNAL_SIGNALS =
  /\b(web|internet|online|trends?|competitor|instagram|tiktok|social media|benchmark|market|search (the web|online))\b/i;

/** Internal project-analysis signals: Owner asking about AMF's own state. */
const INTERNAL_SIGNALS =
  /\b(project state|project status|morroway|my (project|work|team|company)|things (i )?should know|needs (my|owner) attention|blockers?|what changed|what('s| is) (new|happening)|summar(y|ize|ise).{0,30}(project|state|status)|review next|do not change anything)\b/i;

/**
 * Deterministic intent classification. CONTENT_RESEARCH is the safe default:
 * only strong internal signals (without external signals) select internal
 * analysis. Research-agent-only scope is enforced by the caller.
 */
export function classifyResearchIntent(message: string): ResearchIntent {
  const text = message ?? "";
  if (EXTERNAL_SIGNALS.test(text)) return "CONTENT_RESEARCH";
  if (INTERNAL_SIGNALS.test(text)) return "INTERNAL_PROJECT_ANALYSIS";
  return "CONTENT_RESEARCH";
}

/**
 * Exact field ceilings for INTERNAL_ANALYSIS_V1. These bounds are BOTH
 * prompted AND validated, so the worst case is exactly computable and the
 * output budget derives from it instead of being tuned per incident.
 */
export const INTERNAL_ANALYSIS_LIMITS = {
  title: 120,
  finding: 220,
  evidenceItems: 5,
  evidenceItemChars: 160,
  ownerImplication: 220,
  summary: 400,
  recommendedNextStep: 300,
  nextStepAction: 300,
  decisionId: 64,
  limitations: 5,
  limitationChars: 160,
  findingsMin: 1,
  findingsMax: 5,
} as const;

/**
 * Slice 5 remediation V5 — structured next-step authority vocabulary.
 *
 * Authority is declared with enums/booleans/IDs, never inferred from prose.
 * `owner_decision`/`approval` are the ONLY action types that may carry an
 * Owner decision; every other type is non-authoritative project work.
 */
export const NEXT_STEP_ACTORS = ["system", "agent", "team", "owner", "unspecified"] as const;
export type NextStepActor = (typeof NEXT_STEP_ACTORS)[number];
export const NEXT_STEP_ACTION_TYPES = [
  "analysis",
  "planning",
  "documentation",
  "evidence_collection",
  "owner_decision",
  "approval",
  "production",
  "publication",
  "other",
] as const;
export type NextStepActionType = (typeof NEXT_STEP_ACTION_TYPES)[number];
const OWNER_DECISION_ACTION_TYPES: ReadonlySet<string> = new Set(["owner_decision", "approval"]);

const INTERNAL_ANALYSIS_CONTRACT: ResearchContract = {
  id: "INTERNAL_ANALYSIS_V1",
  intent: "INTERNAL_PROJECT_ANALYSIS",
  promptAppendix: [
    "RESPONSE CONTRACT: internal project analysis for the Owner.",
    "Return exactly one compact JSON object with exactly these keys:",
    '{"summary":"string (at most 400 chars)","findings":[{"title":"string (at most 120 chars)","priority":"high|medium|low","finding":"string (at most 220 chars)","evidence":["string, 1 to 5 items of at most 160 chars each"],"ownerImplication":"string (at most 220 chars)","ownerActionRequired":false}],"ownerActionRequired":false,"recommendedNextStep":"string (at most 300 chars)","limitations":["string, at most 5 items of at most 160 chars each"]}.',
    "Rules: findings.length must equal the requested count given below; every finding needs evidence from the supplied platform context (never invent approvals, numbers, or events); ownerActionRequired (finding and top level) must be false unless the supplied context names an actionable Owner decision; respect every stated maximum.",
    "Current-actionability sourcing (mandatory): the ONLY source for whether an Owner decision is currently required is the operational context block (actionable decisions count). A raw pending count, a historical strategic review marker (for example brand-identity review notes), or a superseded/historical approval NEVER implies a current Owner task. When the actionable count is zero: set every ownerActionRequired flag false and do not instruct the Owner to approve, review, decide, or authorize anything now; still recommend the most useful safe next project step (prepare, continue planning, inspect history, gather evidence, define hypotheses).",
  ].join(" "),
  worstCaseBytes: 0,
  externalResearchRequired: false,
  grantsAuthority: false,
};
/**
 * Slice 5 remediation V5 — INTERNAL_ANALYSIS_V2.
 *
 * V1 failure (command-1789910217663): canonical truth held zero actionable
 * Owner decisions and structured flags were correctly false, yet both
 * participants FAILED because free prose (recommendedNextStep /
 * ownerImplication) was regex-scanned as the primary authority signal.
 * Authority wording is model-controlled, so any phrase matcher is an
 * endless patch cycle. V2 declares authority structurally:
 * recommendedNextStep is an object {action, actor, actionType,
 * requiresOwnerDecision, targetDecisionId} and each finding carries
 * ownerDecisionId. Free text explains; structured fields decide.
 * V1 is retained byte-identical for historical artifact readability.
 */
/**
 * Reliability review — single source of truth for INTERNAL_ANALYSIS_V2.
 *
 * INTERNAL_ANALYSIS_LIMITS is the ONLY place ceilings live. The prompt
 * appendix below is generated from it (plus the authority enums), so the
 * prompt, the validator, and the worst-case budget computation cannot
 * drift apart. V1 stays literal (historical, byte-identical).
 */
function internalAnalysisV2PromptAppendix(): string {
  const L = INTERNAL_ANALYSIS_LIMITS;
  return [
    "RESPONSE CONTRACT: internal project analysis for the Owner.",
    "Return exactly one compact JSON object with exactly these keys:",
    `{"summary":"string (at most ${L.summary} chars)","findings":[{"title":"string (at most ${L.title} chars)","priority":"high|medium|low","finding":"string (at most ${L.finding} chars)","evidence":["string, 1 to ${L.evidenceItems} items of at most ${L.evidenceItemChars} chars each"],"ownerImplication":"string (at most ${L.ownerImplication} chars, explains why the finding matters; never an instruction to approve/review/decide)","ownerActionRequired":false,"ownerDecisionId":null (or a decision id of at most ${L.decisionId} chars)}],"ownerActionRequired":false,"recommendedNextStep":{"action":"string (at most ${L.nextStepAction} chars, the recommended work itself)","actor":"${NEXT_STEP_ACTORS.join("|")} (who performs it)","actionType":"${NEXT_STEP_ACTION_TYPES.join("|")}","requiresOwnerDecision":false,"targetDecisionId":null (or a decision id of at most ${L.decisionId} chars)},"limitations":["string, at most ${L.limitations} items of at most ${L.limitationChars} chars each"]}.`,
    "Authority rules (mandatory, structural only): ownerImplication and action are explanatory prose and NEVER create an Owner decision. requiresOwnerDecision=true is allowed only with actor=owner, actionType=owner_decision|approval, and targetDecisionId naming a currently actionable decision from the supplied operational context. ownerActionRequired=true on a finding is allowed only with ownerDecisionId naming such a decision. Top-level ownerActionRequired must equal (recommendedNextStep.requiresOwnerDecision OR any finding.ownerActionRequired).",
    "Current-actionability sourcing (mandatory): the ONLY source for whether an Owner decision is currently required is the operational context block (actionable decisions count and IDs). A raw pending count, a historical strategic review marker, or a superseded/historical approval NEVER implies a current Owner task and NEVER appears as a decision ID. When the actionable count is zero: every ownerActionRequired flag false, every decision ID null, requiresOwnerDecision false, actionType never owner_decision|approval; still recommend the most useful safe next project step (prepare, continue planning, inspect history, gather evidence, define hypotheses).",
    "Context precedence (mandatory): the _operational block is CURRENT truth; current project state comes next; _strategic versions are approved but may be older; referenced artifact text may be stale. On any conflict current truth wins: a PENDING marker in older text never overrides zero actionable decisions and never becomes a decision ID.",
  ].join(" ");
}

const INTERNAL_ANALYSIS_V2_CONTRACT: ResearchContract = {
  id: "INTERNAL_ANALYSIS_V2",
  intent: "INTERNAL_PROJECT_ANALYSIS",
  promptAppendix: internalAnalysisV2PromptAppendix(),
  worstCaseBytes: 0,
  externalResearchRequired: false,
  grantsAuthority: false,
};

const CONTENT_CONTRACT: ResearchContract = {
  id: "CONTENT_RESEARCH_V1",
  intent: "CONTENT_RESEARCH",
  promptAppendix: "",
  worstCaseBytes: 2500,
  externalResearchRequired: false,
  grantsAuthority: false,
};

export function researchContractFor(intent: ResearchIntent): ResearchContract {
  return intent === "INTERNAL_PROJECT_ANALYSIS" ? INTERNAL_ANALYSIS_V2_CONTRACT : CONTENT_CONTRACT;
}

/** Version-pinned lookup: V1 stays available so historical artifacts validate read-only. */
export function researchContractById(id: ResearchContractId): ResearchContract {
  if (id === "INTERNAL_ANALYSIS_V1") return INTERNAL_ANALYSIS_CONTRACT;
  if (id === "INTERNAL_ANALYSIS_V2") return INTERNAL_ANALYSIS_V2_CONTRACT;
  return CONTENT_CONTRACT;
}

/**
 * Slice 5 multi-agent remediation — participant routing.
 *
 * AGENT + INTENT -> RESPONSE CONTRACT. Agent identity alone never decides:
 * a planner doing internal project analysis gets an analysis-compatible
 * contract (with planner perspective), while planner doing planning work
 * keeps the canonical 6-key planning contract byte-identical. Only agents
 * with a defined internal-analysis perspective participate; every other
 * agent keeps its existing contract untouched.
 */
export type ParticipantContractKind = "INTERNAL_ANALYSIS" | "ROLE_DEFAULT";

export interface ParticipantContract {
  readonly kind: ParticipantContractKind;
  readonly contract: ResearchContract | null;
  readonly findingCount: number;
  /** Role perspective framing (evidence vs sequencing); never task answers. */
  readonly perspective: string;
}

const INTERNAL_PERSPECTIVES: Readonly<Record<string, string>> = {
  research: "Emphasize evidence, current facts, constraints, and state truth.",
  planner: "Emphasize sequencing, dependencies, next-step feasibility, and readiness.",
};

const INTERNAL_AGENTS = new Set(Object.keys(INTERNAL_PERSPECTIVES));

export function participantContract(agentId: string, prompt: string): ParticipantContract {
  if (INTERNAL_AGENTS.has(agentId) && classifyResearchIntent(prompt) === "INTERNAL_PROJECT_ANALYSIS") {
    return {
      kind: "INTERNAL_ANALYSIS",
      contract: researchContractFor("INTERNAL_PROJECT_ANALYSIS"),
      findingCount: requestedFindingCount(prompt),
      perspective: INTERNAL_PERSPECTIVES[agentId],
    };
  }
  return { kind: "ROLE_DEFAULT", contract: null, findingCount: 0, perspective: "" };
}

/**
 * Slice 5 live-validation remediation — contract-aware execution policy.
 *
 * Proven split-brain: planner received the internal-analysis contract with
 * the internal budget, but reasoning policy was still selected by agent
 * identity (research-only effort:none). The planner's 1375 reasoning tokens
 * then exhausted the shared 1060 cap with zero visible bytes while research
 * (effort:none) completed on the identical contract. Policy MUST derive
 * from the effective contract, never from agent identity alone.
 */
export interface EffectiveExecutionPolicy {
  readonly intent: ResearchIntent | "ROLE_TASK";
  readonly contractId: ResearchContractId | "ROLE_DEFAULT";
  readonly budget: number;
  readonly reasoning: { readonly effort: "none" } | undefined;
  readonly findingCount: number;
  readonly perspective: string;
}

/**
 * Proven per-role default budgets (only ever changed on failure evidence).
 * Single source of truth; the governed runtime aliases (never duplicates) it.
 */
export const ROLE_OUTPUT_BUDGETS: Readonly<Record<string, number>> = {
  research: 1000,
  planner: 500,
  ceo: 700,
};
export const ROLE_DEFAULT_OUTPUT_BUDGET = 500;

export function roleOutputBudget(agentId: string, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  return ROLE_OUTPUT_BUDGETS[agentId] ?? ROLE_DEFAULT_OUTPUT_BUDGET;
}

const ROLE_BUDGETS = ROLE_OUTPUT_BUDGETS;
const ROLE_DEFAULT_BUDGET = ROLE_DEFAULT_OUTPUT_BUDGET;

export function effectiveExecutionPolicy(input: {
  agentId: string;
  prompt: string;
  explicitBudget?: number;
  explicitReasoning?: { readonly effort: "none" };
}): EffectiveExecutionPolicy {
  const participant = participantContract(input.agentId, input.prompt);
  if (participant.kind === "INTERNAL_ANALYSIS") {
    return {
      intent: "INTERNAL_PROJECT_ANALYSIS",
      contractId: "INTERNAL_ANALYSIS_V2",
      budget: input.explicitBudget ?? internalAnalysisBudget(participant.findingCount),
      reasoning: input.explicitReasoning ?? { effort: "none" },
      findingCount: participant.findingCount,
      perspective: participant.perspective,
    };
  }
  return {
    intent: input.agentId === "research" ? "CONTENT_RESEARCH" : "ROLE_TASK",
    contractId: input.agentId === "research" ? "CONTENT_RESEARCH_V1" : "ROLE_DEFAULT",
    budget: input.explicitBudget ?? ROLE_BUDGETS[input.agentId] ?? ROLE_DEFAULT_BUDGET,
    reasoning: input.explicitReasoning ?? (input.agentId === "research" ? { effort: "none" } : undefined),
    findingCount: 0,
    perspective: "",
  };
}

/** Worst-case INTERNAL_ANALYSIS_V2 serialized bytes for a finding count (exact schema ceiling). */
export function internalAnalysisWorstCaseBytes(findingCount: number): number {
  const L = INTERNAL_ANALYSIS_LIMITS;
  const n = Math.min(Math.max(Math.floor(findingCount) || 3, 1), L.findingsMax);
  const finding = {
    title: "x".repeat(L.title), priority: "medium",
    finding: "x".repeat(L.finding),
    evidence: Array.from({ length: L.evidenceItems }, () => "x".repeat(L.evidenceItemChars)),
    ownerImplication: "x".repeat(L.ownerImplication), ownerActionRequired: true,
    ownerDecisionId: "x".repeat(L.decisionId),
  };
  const payload = {
    summary: "x".repeat(L.summary),
    findings: Array.from({ length: n }, () => finding),
    ownerActionRequired: true,
    recommendedNextStep: {
      action: "x".repeat(L.nextStepAction), actor: "unspecified",
      actionType: "evidence_collection", requiresOwnerDecision: true,
      targetDecisionId: "x".repeat(L.decisionId),
    },
    limitations: Array.from({ length: L.limitations }, () => "x".repeat(L.limitationChars)),
  };
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

/** Historical V1 worst case (unchanged schema; kept for byte-parity reference). */
export function internalAnalysisV1WorstCaseBytes(findingCount: number): number {
  const L = INTERNAL_ANALYSIS_LIMITS;
  const n = Math.min(Math.max(Math.floor(findingCount) || 3, 1), L.findingsMax);
  const finding = {
    title: "x".repeat(L.title), priority: "medium",
    finding: "x".repeat(L.finding),
    evidence: Array.from({ length: L.evidenceItems }, () => "x".repeat(L.evidenceItemChars)),
    ownerImplication: "x".repeat(L.ownerImplication), ownerActionRequired: false,
  };
  const payload = {
    summary: "x".repeat(L.summary),
    findings: Array.from({ length: n }, () => finding),
    ownerActionRequired: false,
    recommendedNextStep: "x".repeat(L.recommendedNextStep),
    limitations: Array.from({ length: L.limitations }, () => "x".repeat(L.limitationChars)),
  };
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

/**
 * Slice 5 finalization RCA (command-1789913111377) — CEO synthesis
 * contract-aware execution policy.
 *
 * Proven split-brain: participants ran under the V2 contract policy
 * (ceiling-derived budget + effort:none, reasoning_tokens=0) while the CEO
 * synthesis kept legacy settings (flat 1000 cap, uncontrolled reasoning).
 * The reasoning model burned 1356 reasoning tokens inside the 1000-token
 * cap with zero visible bytes (finish length) — the same failure class as
 * the V3 planner incident, migrated to the synthesis path. Policy MUST
 * derive from the effective contract on EVERY governed path, synthesis
 * included. Budget uses the identical ceiling formula (bytes/3.0, round
 * 50s); the 1000 floor preserves the previously proven value.
 */
export const CEO_SYNTHESIS_LIMITS = { text: 220, listItems: 3 } as const;

/** Worst-case CEO synthesis serialized bytes (exact schema ceiling). */
export function ceoSynthesisWorstCaseBytes(): number {
  const t = "x".repeat(CEO_SYNTHESIS_LIMITS.text);
  const list = Array.from({ length: CEO_SYNTHESIS_LIMITS.listItems }, () => t);
  return Buffer.byteLength(JSON.stringify({
    agreements: list, disagreements: list, evidence: list,
    recommendation: t, confidence: 1, missingEvidence: list, nextAction: t,
  }), "utf8");
}

/** CEO synthesis output budget derived from the exact schema ceiling above. */
export function ceoSynthesisBudget(): number {
  return Math.max(1000, Math.ceil(ceoSynthesisWorstCaseBytes() / 3.0 / 50) * 50);
}

/** Words for explicit cardinalities ("three", "top 5", "two blockers"). Clamped 1..5. */
const CARDINAL_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
};

/** Requested finding count: explicit cardinal wins, else default 3. Never global-hardcoded per prompt. */
export function requestedFindingCount(message: string): number {
  const text = message ?? "";
  const top = /\btop\s+([1-5])\b/i.exec(text);
  if (top) return Number(top[1]);
  const digit = /\b([1-5])\s+(things|risks|blockers|findings|items|points)\b/i.exec(text);
  if (digit) return Number(digit[1]);
  const word = new RegExp(`\\b(${Object.keys(CARDINAL_WORDS).join("|")})\\s+(things|risks|blockers|findings|items|points)\\b`, "i").exec(text);
  if (word) return CARDINAL_WORDS[word[1].toLowerCase()];
  return 3;
}

/**
 * Output budget derived from the exact schema ceiling above: worst-case
 * bytes divided by a conservative 3.0 bytes/token, rounded up to 50s,
 * floor 800. Deterministic and documented — a ceiling computation, never
 * per-incident inflation. For the default count of 3 this yields a budget
 * that provably fits every schema-valid output.
 */
export function internalAnalysisBudget(findingCount: number): number {
  const n = Math.min(Math.max(Math.floor(findingCount) || 3, 1), INTERNAL_ANALYSIS_LIMITS.findingsMax);
  return Math.max(800, Math.ceil(internalAnalysisWorstCaseBytes(n) / 3.0 / 50) * 50);
}

export interface InternalFinding {
  readonly title: unknown;
  readonly priority: unknown;
  readonly finding: unknown;
  readonly evidence: unknown;
  readonly ownerImplication: unknown;
  readonly ownerActionRequired: unknown;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Slice 5 remediation V3/V6 — action-language detection for free-text fields.
 *
 * V5 scope note: this matcher is NO LONGER applied to internal-analysis
 * participant prose (recommendedNextStep/ownerImplication are explanatory
 * only under V2 structured authority). It remains SOLELY as the
 * conservative backstop for the CEO synthesis free-text contract
 * (recommendation/nextAction), which has no structured authority fields.
 *
 * V6 negation guard (command-1789912080235): a verb+noun match negated in
 * its own clause ("without authorizing publication", "do not approve X",
 * "never authorize Y") advises AGAINST action and fabricates no decision —
 * failing it was a false positive that FAILED an otherwise valid synthesis.
 * Only affirmative (non-negated) instructions count. Conditional hedges
 * ("until", "unless") do NOT suppress: they still gate work on an Owner
 * decision. Do not extend the verb/noun lists per incident.
 */
const ACTION_VERBS = "(complete|completing|approve|approving|review|reviewing|decide|deciding|authorize|authorising|authorizing|grant|granting|confirm|ratify|sign off|request approval for)";
const AUTHORITY_NOUNS = "(approval|approvals|review|decision|decisions|gate|authorization|authorisation|sign-off|signoff|publication|publishing|publish)";
const AUTHORITY_NEGATIONS = /\b(without|no|not|never|neither|nor)\b|n't\b/i;

export function recommendsOwnerDecision(text: unknown): boolean {
  if (typeof text !== "string") return false;
  const scan = new RegExp(`\\b${ACTION_VERBS}\\b[^.]{0,60}\\b${AUTHORITY_NOUNS}\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = scan.exec(text)) !== null) {
    // Same-clause window before the verb (bounded): a negation there means
    // the sentence refuses an Owner action rather than instructing one.
    let s = m.index;
    while (s > 0 && m.index - s < 80 && !/[.!?;]/.test(text[s - 1] ?? "")) s--;
    if (!AUTHORITY_NEGATIONS.test(text.slice(s, m.index))) return true;
  }
  return false;
}

/**
 * Semantic validation for internal-analysis output (V1, historical).
 * Byte-identical behavior retained so historical V1 artifacts stay readable
 * and re-validatable. New executions use validateInternalAnalysisV2.
 * actionableDecisions = canonical count of currently actionable Owner
 * decisions from platform truth (0 for Morroway today).
 */
export function validateInternalAnalysis(
  output: unknown,
  input: { requestedCount: number; actionableDecisions: number },
): { ok: true } | { ok: false; reason: string } {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return { ok: false, reason: "output is not an object" };
  }
  const o = output as Record<string, unknown>;
  for (const key of ["summary", "findings", "ownerActionRequired", "recommendedNextStep", "limitations"]) {
    if (o[key] === undefined || o[key] === null) return { ok: false, reason: `missing key: ${key}` };
  }
  const L = INTERNAL_ANALYSIS_LIMITS;
  const bounded = (v: unknown, max: number): v is string => isString(v) && v.length <= max;
  // Granular reasons: each check names its field so future RCAs never guess.
  if (!isString(o.summary)) return { ok: false, reason: "summary is not a string" };
  if (o.summary.length > L.summary) return { ok: false, reason: `summary exceeds ceiling ${o.summary.length}/${L.summary}` };
  if (!isString(o.recommendedNextStep)) return { ok: false, reason: "recommendedNextStep is not a string" };
  if (o.recommendedNextStep.length > L.recommendedNextStep) return { ok: false, reason: `recommendedNextStep exceeds ceiling ${o.recommendedNextStep.length}/${L.recommendedNextStep}` };
  if (!Array.isArray(o.limitations)) return { ok: false, reason: "limitations is not an array" };
  if (o.limitations.length > L.limitations || !o.limitations.every((x) => bounded(x, L.limitationChars))) {
    return { ok: false, reason: "limitations exceed ceilings" };
  }
  if (!Array.isArray(o.findings)) return { ok: false, reason: "findings is not an array" };
  if (o.findings.length !== input.requestedCount) {
    return { ok: false, reason: `findings count ${o.findings.length} != requested ${input.requestedCount}` };
  }
  for (const [i, f] of o.findings.entries()) {
    const finding = f as InternalFinding;
    if (finding === null || typeof finding !== "object") return { ok: false, reason: `finding ${i} is not an object` };
    for (const key of ["title", "priority", "finding", "evidence", "ownerImplication", "ownerActionRequired"] as const) {
      if (finding[key] === undefined || finding[key] === null) return { ok: false, reason: `finding ${i} missing ${key}` };
    }
    if (!bounded(finding.title, L.title) || !["high", "medium", "low"].includes(String(finding.priority)) || !bounded(finding.finding, L.finding) || !bounded(finding.ownerImplication, L.ownerImplication)) {
      return { ok: false, reason: `finding ${i} fields exceed ceilings or priority invalid` };
    }
    if (!Array.isArray(finding.evidence) || finding.evidence.length < 1 || finding.evidence.length > L.evidenceItems || !finding.evidence.every((x) => bounded(x, L.evidenceItemChars))) {
      return { ok: false, reason: `finding ${i} evidence must be 1-${L.evidenceItems} items within ceilings` };
    }
    if (typeof finding.ownerActionRequired !== "boolean") return { ok: false, reason: `finding ${i} ownerActionRequired not boolean` };
    // Canonical truth guard: no actionable decisions => nothing may demand Owner action.
    if (input.actionableDecisions === 0 && finding.ownerActionRequired === true) {
      return { ok: false, reason: `finding ${i} claims Owner action with zero actionable decisions in platform truth` };
    }
  }
  if (typeof o.ownerActionRequired !== "boolean") return { ok: false, reason: "ownerActionRequired not boolean" };
  if (input.actionableDecisions === 0 && o.ownerActionRequired === true) {
    return { ok: false, reason: "claims Owner action with zero actionable decisions in platform truth" };
  }
  // Text-level consistency (V3): with zero actionable decisions, neither the
  // next step nor any implication may instruct a current Owner decision —
  // even when all boolean flags are correctly false.
  if (input.actionableDecisions === 0) {
    if (recommendsOwnerDecision(o.recommendedNextStep)) {
      return { ok: false, reason: "recommendedNextStep instructs an Owner decision with zero actionable decisions in platform truth" };
    }
    for (const [i, f] of (o.findings as InternalFinding[]).entries()) {
      if (recommendsOwnerDecision(f.ownerImplication)) {
        return { ok: false, reason: `finding ${i} implication instructs an Owner decision with zero actionable decisions in platform truth` };
      }
    }
  }
  return { ok: true };
}

export interface InternalAnalysisTruth {
  readonly requestedCount: number;
  readonly actionableDecisions: number;
  /** Canonical currently-actionable decision IDs (<0/absent truth => structure only). */
  readonly actionableIds?: readonly string[] | null;
}

export interface InternalFindingV2 extends InternalFinding {
  readonly ownerDecisionId: unknown;
}

export interface InternalNextStepV2 {
  readonly action: unknown;
  readonly actor: unknown;
  readonly actionType: unknown;
  readonly requiresOwnerDecision: unknown;
  readonly targetDecisionId: unknown;
}

/**
 * Slice 5 remediation V5 — structured authority validation (INTERNAL_ANALYSIS_V2).
 *
 * Invariant: canonical current actionability + structured response metadata
 * = authority validation. Free prose (ownerImplication, next-step action) is
 * explanatory and is NEVER scanned here — prose sensitivity caused the
 * command-1789910217663 double failure with every structured flag correctly
 * false. Fail-closed: any structural gap, cardinality mismatch,
 * cross-field contradiction, or ungrounded authority claim rejects, and no
 * artifact is created.
 */
export function validateInternalAnalysisV2(
  output: unknown,
  input: InternalAnalysisTruth,
): { ok: true } | { ok: false; reason: string } {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return { ok: false, reason: "output is not an object" };
  }
  const o = output as Record<string, unknown>;
  for (const key of ["summary", "findings", "ownerActionRequired", "recommendedNextStep", "limitations"]) {
    if (o[key] === undefined || o[key] === null) return { ok: false, reason: `missing key: ${key}` };
  }
  const L = INTERNAL_ANALYSIS_LIMITS;
  const bounded = (v: unknown, max: number): v is string => isString(v) && v.length <= max;
  const decisionId = (v: unknown): v is string => isString(v) && v.length >= 1 && v.length <= L.decisionId;
  if (!isString(o.summary)) return { ok: false, reason: "summary is not a string" };
  if (o.summary.length > L.summary) return { ok: false, reason: `summary exceeds ceiling ${o.summary.length}/${L.summary}` };
  if (!Array.isArray(o.limitations)) return { ok: false, reason: "limitations is not an array" };
  if (o.limitations.length > L.limitations) {
    return { ok: false, reason: `limitations must hold at most ${L.limitations} items (got ${o.limitations.length})` };
  }
  for (const [j, item] of (o.limitations as unknown[]).entries()) {
    if (!isString(item)) return { ok: false, reason: `limitations[${j}] is not a string` };
    if (item.length > L.limitationChars) {
      return { ok: false, reason: `limitations[${j}] length ${item.length} exceeds ${L.limitationChars}` };
    }
  }
  // Structured next step: the object is the single canonical authority source.
  const rawNext = o.recommendedNextStep;
  if (rawNext === null || typeof rawNext !== "object" || Array.isArray(rawNext)) {
    return { ok: false, reason: "recommendedNextStep must be an object (INTERNAL_ANALYSIS_V2)" };
  }
  const ns = rawNext as unknown as InternalNextStepV2;
  for (const key of ["action", "actor", "actionType", "requiresOwnerDecision", "targetDecisionId"] as const) {
    if (ns[key] === undefined) return { ok: false, reason: `recommendedNextStep missing ${key}` };
  }
  if (!isString(ns.action)) return { ok: false, reason: "recommendedNextStep.action is not a string" };
  if (ns.action.length > L.nextStepAction) {
    return { ok: false, reason: `recommendedNextStep.action length ${ns.action.length} exceeds ${L.nextStepAction}` };
  }
  if (!isString(ns.actor) || !(NEXT_STEP_ACTORS as readonly string[]).includes(ns.actor)) {
    return { ok: false, reason: `recommendedNextStep.actor must be one of ${NEXT_STEP_ACTORS.join("|")}` };
  }
  if (!isString(ns.actionType) || !(NEXT_STEP_ACTION_TYPES as readonly string[]).includes(ns.actionType)) {
    return { ok: false, reason: `recommendedNextStep.actionType must be one of ${NEXT_STEP_ACTION_TYPES.join("|")}` };
  }
  if (typeof ns.requiresOwnerDecision !== "boolean") {
    return { ok: false, reason: "recommendedNextStep.requiresOwnerDecision not boolean" };
  }
  if (ns.targetDecisionId !== null && !decisionId(ns.targetDecisionId)) {
    return { ok: false, reason: "recommendedNextStep.targetDecisionId must be null or a non-empty id" };
  }
  const nextRequires = ns.requiresOwnerDecision === true;
  const nextDecisionType = OWNER_DECISION_ACTION_TYPES.has(String(ns.actionType));
  // Cross-field consistency (truth-independent): authority claims must cohere.
  if (nextRequires && ns.actor !== "owner") {
    return { ok: false, reason: "recommendedNextStep requires an Owner decision but actor is not owner" };
  }
  if (nextRequires && !nextDecisionType) {
    return { ok: false, reason: "recommendedNextStep requires an Owner decision but actionType is not owner_decision|approval" };
  }
  if (nextRequires && ns.targetDecisionId === null) {
    return { ok: false, reason: "recommendedNextStep requires an Owner decision but names no targetDecisionId" };
  }
  if (!nextRequires && nextDecisionType) {
    return { ok: false, reason: "recommendedNextStep actionType declares Owner-decision work with requiresOwnerDecision=false" };
  }
  if (!nextRequires && ns.targetDecisionId !== null) {
    return { ok: false, reason: "recommendedNextStep names a targetDecisionId with requiresOwnerDecision=false" };
  }
  if (!Array.isArray(o.findings)) return { ok: false, reason: "findings is not an array" };
  if (o.findings.length !== input.requestedCount) {
    return { ok: false, reason: `findings count ${o.findings.length} != requested ${input.requestedCount}` };
  }
  let anyFindingClaims = false;
  const claimedIds: Array<{ where: string; id: string }> = [];
  for (const [i, f] of o.findings.entries()) {
    const finding = f as unknown as InternalFindingV2;
    if (finding === null || typeof finding !== "object") return { ok: false, reason: `finding ${i} is not an object` };
    for (const key of ["title", "priority", "finding", "evidence", "ownerImplication", "ownerActionRequired", "ownerDecisionId"] as const) {
      if (finding[key] === undefined) return { ok: false, reason: `finding ${i} missing ${key}` };
    }
    // Reliability review: one precise path per field (never a combined
    // message) so live RCAs name the exact property, length, and limit.
    if (!isString(finding.title)) return { ok: false, reason: `findings[${i}].title is not a string` };
    if (finding.title.length > L.title) {
      return { ok: false, reason: `findings[${i}].title length ${finding.title.length} exceeds ${L.title}` };
    }
    if (!["high", "medium", "low"].includes(String(finding.priority))) {
      return { ok: false, reason: `findings[${i}].priority invalid value ${JSON.stringify(String(finding.priority)).slice(0, 40)} (expected high|medium|low)` };
    }
    if (!isString(finding.finding)) return { ok: false, reason: `findings[${i}].finding is not a string` };
    if (finding.finding.length > L.finding) {
      return { ok: false, reason: `findings[${i}].finding length ${finding.finding.length} exceeds ${L.finding}` };
    }
    if (!isString(finding.ownerImplication)) return { ok: false, reason: `findings[${i}].ownerImplication is not a string` };
    if (finding.ownerImplication.length > L.ownerImplication) {
      return { ok: false, reason: `findings[${i}].ownerImplication length ${finding.ownerImplication.length} exceeds ${L.ownerImplication}` };
    }
    if (!Array.isArray(finding.evidence) || finding.evidence.length < 1 || finding.evidence.length > L.evidenceItems) {
      return { ok: false, reason: `findings[${i}].evidence must hold 1-${L.evidenceItems} items (got ${Array.isArray(finding.evidence) ? finding.evidence.length : "non-array"})` };
    }
    for (const [j, item] of finding.evidence.entries()) {
      if (!isString(item)) return { ok: false, reason: `findings[${i}].evidence[${j}] is not a string` };
      if (item.length > L.evidenceItemChars) {
        return { ok: false, reason: `findings[${i}].evidence[${j}] length ${item.length} exceeds ${L.evidenceItemChars}` };
      }
    }
    if (typeof finding.ownerActionRequired !== "boolean") return { ok: false, reason: `finding ${i} ownerActionRequired not boolean` };
    if (finding.ownerDecisionId !== null && !decisionId(finding.ownerDecisionId)) {
      return { ok: false, reason: `finding ${i} ownerDecisionId must be null or a non-empty id` };
    }
    // ownerImplication explains why the finding matters; it is never scanned
    // for authority language (V5 structural-authority invariant).
    if (finding.ownerActionRequired === true) {
      anyFindingClaims = true;
      if (finding.ownerDecisionId === null) {
        return { ok: false, reason: `finding ${i} claims Owner action but names no ownerDecisionId` };
      }
      claimedIds.push({ where: `finding ${i}`, id: String(finding.ownerDecisionId) });
    } else if (finding.ownerDecisionId !== null) {
      return { ok: false, reason: `finding ${i} names an ownerDecisionId with ownerActionRequired=false` };
    }
  }
  if (typeof o.ownerActionRequired !== "boolean") return { ok: false, reason: "ownerActionRequired not boolean" };
  const topClaims = o.ownerActionRequired === true;
  if (topClaims !== (nextRequires || anyFindingClaims)) {
    return { ok: false, reason: "top-level ownerActionRequired must equal (recommendedNextStep.requiresOwnerDecision OR any finding.ownerActionRequired)" };
  }
  if (nextRequires) claimedIds.push({ where: "recommendedNextStep", id: String(ns.targetDecisionId) });
  // Grounding against canonical platform truth.
  if (input.actionableDecisions === 0) {
    if (topClaims || nextRequires || anyFindingClaims) {
      return { ok: false, reason: "claims Owner action with zero actionable decisions in platform truth" };
    }
  } else if (input.actionableDecisions > 0 && input.actionableIds !== undefined && input.actionableIds !== null) {
    const allowed = new Set(input.actionableIds);
    for (const claim of claimedIds) {
      if (!allowed.has(claim.id)) {
        return { ok: false, reason: `${claim.where} references decision ${claim.id.slice(0, 40)} which is not currently actionable in platform truth` };
      }
    }
  }
  // Absent truth (actionableDecisions < 0): structural + consistency checks
  // only. Present count without an ID list: IDs must still be well-formed
  // and self-consistent (legacy leniency, same as V1).
  return { ok: true };
}

/** Artifact sections so the viewer renders findings first-class (no empty Sections). */
export function internalAnalysisSections(output: {
  summary: string; findings: Array<{ title: string; finding: string; ownerImplication: string }>;
  recommendedNextStep:
    | string
    | { action: string; actor: string; actionType?: string; requiresOwnerDecision?: boolean };
}): Array<{ title: string; body: string }> {
  const sections = output.findings.map((f, i) => ({
    title: `${i + 1}. ${f.title}`,
    body: `${f.finding} Why it matters: ${f.ownerImplication}`,
  }));
  // Deterministic authority rendering (V5 option C): the model supplies the
  // recommended work; actor/decision-requirement lines render verbatim from
  // structured metadata and are never rewritten by prose.
  const next = output.recommendedNextStep;
  const nextBody = typeof next === "string"
    ? next
    : `${next.action} Actor: ${next.actor}. Owner decision required: ${next.requiresOwnerDecision ? "Yes" : "No"}.`;
  sections.push({ title: "Recommended next step", body: nextBody });
  return [{ title: "Summary", body: output.summary }, ...sections];
}
