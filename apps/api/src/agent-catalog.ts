/**
 * Slice 4 — canonical agent roster (Owner truth, not a second registry).
 *
 * Entries mirror the canonical runtime registration
 * (`bootstrapCanonicalAgentRegistry`) with Owner-readable names, roles and
 * responsibilities paraphrased from each agent's governed role prompt.
 * Telemetry ids with no registry entry are surfaced separately as runtime
 * components, never invented as team members.
 */

export interface AgentCatalogEntry {
  readonly key: string;
  readonly displayName: string;
  readonly role: string;
  readonly responsibilities: string;
  readonly registered: boolean;
  /** Presentation-only Owner navigation group (no runtime meaning). */
  readonly group: string;
}

const ROSTER: readonly AgentCatalogEntry[] = [
  { key: "research", displayName: "Research Agent", role: "Finds and verifies information before content creation.", responsibilities: "Produces source-backed research with citations and confidence; never invents sources.", registered: true , group: "Research & Strategy" },
  { key: "planner", displayName: "Planner", role: "Breaks objectives into ordered, well-scoped tasks.", responsibilities: "Turns goals into plans with hooks, structure, audience fit and risks.", registered: true , group: "Leadership" },
  { key: "writer", displayName: "Writer", role: "Turns the approved brief into the content script.", responsibilities: "Writes only from approved research and briefs; never invents facts.", registered: true , group: "Content & Creative" },
  { key: "seo", displayName: "SEO Specialist", role: "Makes content findable on each target platform.", responsibilities: "Derives titles, keywords and structure only from the approved script.", registered: true , group: "Content & Creative" },
  { key: "brand", displayName: "Brand Strategist", role: "Keeps every output inside brand identity and policy.", responsibilities: "Gates content against supplied brand guidelines; approves only clean checks.", registered: true , group: "Content & Creative" },
  { key: "director", displayName: "Director", role: "Plans scenes before narration and visuals are made.", responsibilities: "Authors the provider-neutral scene plan from story and brand.", registered: true , group: "Media Production" },
  { key: "visual-director", displayName: "Visual Director", role: "Plans the visual language and scene direction.", responsibilities: "Authors the visual direction contract; never generates images or approves its own work.", registered: true , group: "Content & Creative" },
  { key: "review", displayName: "Reviewer", role: "Checks content before it moves forward.", responsibilities: "Reviews correctness, structure and risk; blocks when context is insufficient.", registered: true , group: "Content & Creative" },
  { key: "thumbnail", displayName: "Thumbnail Designer", role: "Designs thumbnail concepts from evidence.", responsibilities: "Derives image prompts deterministically; never claims without runtime evidence.", registered: true , group: "Content & Creative" },
  { key: "video", displayName: "Video Designer", role: "Prepares governed video generation requests.", responsibilities: "Validates visual lineage and authorization before requesting video work.", registered: true , group: "Media Production" },
  { key: "scene-image", displayName: "Scene Artist", role: "Produces per-scene visuals under contract.", responsibilities: "Generates scene images deterministically from the approved prompt contract.", registered: true , group: "Media Production" },
  { key: "visual-semantic-review", displayName: "Visual Story Reviewer", role: "Checks visuals against story and brand meaning.", responsibilities: "Reviews scene visuals for story fit and brand compliance.", registered: true , group: "Media Production" },
  { key: "visual-technical-qa", displayName: "Visual QA Reviewer", role: "Checks visuals for technical quality.", responsibilities: "Checks continuity, policy and integrity of scene visuals.", registered: true , group: "Media Production" },
  { key: "wan-authorization", displayName: "Video Generation Gate", role: "Authorizes visual-to-video lineage.", responsibilities: "Deterministic gate before video generation; fail-closed.", registered: true , group: "Media Production" },
  { key: "tts", displayName: "Narrator", role: "Turns narration text into voice audio.", responsibilities: "Validates narration requests and produces voice audio through the governed voice route.", registered: true , group: "Media Production" },
  { key: "timeline", displayName: "Timeline Planner", role: "Plans scene timing from narration.", responsibilities: "Builds the timeline plan linking narration duration to scenes.", registered: true , group: "Media Production" },
  { key: "composer", displayName: "Composer", role: "Assembles the final media package.", responsibilities: "Validates narration, timeline and clips, then composes final media deterministically.", registered: true , group: "Media Production" },
  { key: "qa", displayName: "QA Analyst", role: "Verifies content and media quality with evidence.", responsibilities: "Runs content, engineering and final-media QA only against runtime evidence.", registered: true , group: "Media Production" },
  { key: "publisher", displayName: "Publisher", role: "Prepares validated releases for publication.", responsibilities: "Validates the brand, QA and video chain before requesting publication.", registered: true , group: "Media Production" },
  { key: "publisher-authorization", displayName: "Publication Gate", role: "Guards the publication boundary.", responsibilities: "Fail-closed owner/policy check before anything may publish.", registered: true , group: "Media Production" },
  { key: "analytics", displayName: "Analyst", role: "Measures published performance.", responsibilities: "Fetches provider-confirmed metrics after publication.", registered: true , group: "Growth & Analytics" },
  { key: "growth", displayName: "Growth Strategist", role: "Advises pre-publication growth strategy.", responsibilities: "Works from approved research and content; never invents metrics.", registered: true , group: "Growth & Analytics" },
  { key: "finance", displayName: "Finance Analyst", role: "Advises budgets, pricing and monetization.", responsibilities: "Never invents money values and never transacts.", registered: true , group: "Growth & Analytics" },
  { key: "ceo", displayName: "CEO", role: "Synthesizes specialist work into decisions.", responsibilities: "Combines validated agent outputs into recommendations with explicit confidence.", registered: true , group: "Leadership" },
];

const BY_KEY = new Map(ROSTER.map((a) => [a.key, a]));

export function agentCatalog(): readonly AgentCatalogEntry[] {
  return ROSTER;
}

export function catalogEntry(agentKey: string): AgentCatalogEntry {
  const known = BY_KEY.get(agentKey);
  if (known) return known;
  const name = agentKey.split(/[-_]/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
  return {
    key: agentKey, displayName: name, role: "Runtime component",
    responsibilities: "Internal runtime helper observed in execution records; not a registered team member.",
    registered: false, group: "Runtime components",
  };
}

/** Friendly provider names for Owner display. Unknown values pass through humanized, never invented. */
export function friendlyProvider(provider: string | null): string {
  if (!provider) return "Not recorded";
  const map: Record<string, string> = {
    openrouter: "OpenRouter", agentrouter: "AgentRouter", "agentrouter-openai": "AgentRouter (OpenAI)",
    local: "Local runtime", deterministic: "Deterministic (no model)", "worker-deterministic": "Deterministic (no model)",
    "deterministic-v2": "Deterministic (no model)", "self-hosted-image": "Self-hosted image GPU",
    voicetut: "VoiceTut", groq: "Groq", planner: "Deterministic planner",
  };
  return map[provider] ?? provider.split(/[-_]/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/** Human-readable relative time. Exact timestamps stay in Advanced. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "Unknown";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const d = new Date(t);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
