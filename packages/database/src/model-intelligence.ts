/** Canonical, provider-evidenced OpenRouter model catalog and price history. */
import { createHash } from "node:crypto";
import type pg from "pg";

export type ProviderDeclaredState = "DECLARED" | "NOT_DECLARED" | "UNKNOWN";
export type PriceClass = "FREE" | "PAID" | "UNKNOWN";
export interface ProviderModelInput { id: string; canonical_slug?: string; name?: string; description?: string; context_length?: number; architecture?: unknown; supported_parameters?: unknown; pricing?: unknown; benchmarks?: unknown; [key: string]: unknown; }
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const stable = (v: unknown) => JSON.stringify(canonical(v));
const hash = (v: unknown) => createHash("sha256").update(stable(v)).digest("hex");
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const numeric = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

export function normalizeProviderModel(raw: ProviderModelInput) {
  const architecture = obj(raw.architecture), pricing = obj(raw.pricing);
  const parameters = list(raw.supported_parameters);
  const input = list(architecture.input_modalities), output = list(architecture.output_modalities);
  const declares = (condition: boolean, evidenceKnown = true): ProviderDeclaredState => !evidenceKnown ? "UNKNOWN" : condition ? "DECLARED" : "NOT_DECLARED";
  const has = (...names: string[]) => names.some((n) => parameters.includes(n));
  const normalizedPricing: Record<string, { raw: unknown; usdPerMillion?: number }> = {};
  let positive = false, unknownPrice = false;
  for (const [key, value] of Object.entries(pricing)) {
    const n = numeric(value); if (n === null) { unknownPrice = true; normalizedPricing[key] = { raw: value }; }
    else { if (n < 0) unknownPrice = true; if (n > 0) positive = true; normalizedPricing[key] = { raw: value, ...(n >= 0 ? { usdPerMillion: n * 1_000_000 } : {}) }; }
  }
  // Core token prices establish PAID when both are valid and either is
  // positive. Nested/special pricing (for example context overrides) remains
  // preserved raw and may be independently UNKNOWN; it must not erase valid
  // prompt/completion evidence. FREE remains intentionally strict.
  const prompt = numeric(pricing.prompt), completion = numeric(pricing.completion);
  const coreKnown = prompt !== null && completion !== null && prompt >= 0 && completion >= 0;
  const allTopLevelNumericZero = Object.values(pricing).length > 0 && Object.values(pricing).every((v) => numeric(v) === 0);
  const priceClass: PriceClass = coreKnown && (prompt! > 0 || completion! > 0)
    ? "PAID"
    : allTopLevelNumericZero && !unknownPrice
      ? "FREE"
      : positive && coreKnown ? "PAID" : "UNKNOWN";
  const capabilities = {
    toolCalling: declares(has("tools", "tool_choice")), structuredOutput: declares(has("structured_outputs", "response_format", "json_schema")),
    reasoning: declares(!!raw.reasoning || has("reasoning", "include_reasoning")), vision: declares(input.includes("image")),
    audio: declares(input.includes("audio") || output.includes("audio")), imageGeneration: declares(output.includes("image")),
  };
  return { providerModelId: raw.id, canonicalSlug: raw.canonical_slug ?? null, canonicalName: raw.name ?? raw.id,
    author: raw.id.includes("/") ? raw.id.split("/", 1)[0] : null, description: raw.description ?? null,
    contextLength: typeof raw.context_length === "number" ? raw.context_length : null, architecture, inputModalities: input, outputModalities: output,
    supportedParameters: parameters, capabilities, pricingRaw: pricing, pricingNormalized: normalizedPricing, priceClass,
    benchmarkMetadata: raw.benchmarks ?? null, rawMetadata: raw, contentHash: hash(raw), pricingHash: hash(pricing), capabilityHash: hash({architecture, parameters, reasoning: raw.reasoning ?? null}), descriptionHash: hash(raw.description ?? null) };
}

export interface ModelQuery {
  priceClass?: PriceClass;
  search?: string;
  providerAuthor?: string;
  capability?: "reasoning"|"vision"|"audio"|"toolCalling"|"structuredOutput"|"imageGeneration";
  evaluation?: string;
  availability?: string;
  sort?: "name"|"provider"|"inputPrice"|"outputPrice"|"context"|"recentlyAdded"|"recentlyChanged";
  direction?: "asc"|"desc";
  page?: number;
  pageSize?: number;
}

const declaredCount = (m:any) => Object.values(m.capabilities||{}).filter(v=>v==="DECLARED").length;
const pricePerMillion = (m:any,key:string):number|null => {
  const raw=m.pricing_normalized?.[key]?.usdPerMillion; return typeof raw==="number"&&Number.isFinite(raw)?raw:null;
};
const positioned = (m:any, pattern:RegExp) => pattern.test(String(m.description||""));
export function shortlistReasons(m:any, kind:"FREE"|"PAID"|"REFERENCE"|"SPECIALIST"):string[] {
  const reasons:string[]=[]; const c=m.capabilities||{};
  if(m.price_class==="FREE") reasons.push("FREE");
  if(kind==="PAID") reasons.push("LOW_COST");
  if((m.context_length||0)>=100000) reasons.push("LARGE_CONTEXT");
  if(c.reasoning==="DECLARED") reasons.push("REASONING");
  if(c.toolCalling==="DECLARED") reasons.push("TOOL_CALLING");
  if(c.structuredOutput==="DECLARED") reasons.push("STRUCTURED_OUTPUT");
  if(c.vision==="DECLARED") reasons.push("VISION");
  if(c.audio==="DECLARED"||c.imageGeneration==="DECLARED") reasons.push("MULTIMODAL");
  if(positioned(m,/creative|story|writing|narrative|roleplay/i)) reasons.push("CREATIVE_WRITING_POSITIONING");
  if(positioned(m,/agentic|tool use|function call/i)) reasons.push("AGENTIC_POSITIONING");
  if(kind==="REFERENCE") reasons.unshift("REFERENCE_FAMILY","HIGH_CAPABILITY_METADATA");
  return [...new Set(reasons)];
}
export function suggestedRoles(m:any):string[] {
  const c=m.capabilities||{}, roles:string[]=[];
  if(c.reasoning==="DECLARED") roles.push("Research","Planning / Reasoning","Critic / QA");
  if(c.toolCalling==="DECLARED") roles.push("Research","Tool Use","Orchestrator Support");
  if(c.structuredOutput==="DECLARED") roles.push("SEO / Metadata","Structured Output");
  if(c.vision==="DECLARED") roles.push("Vision / Multimodal","Visual QA");
  if(positioned(m,/creative|story|writing|narrative|roleplay/i)) roles.push("Script / Creative Writing");
  if(positioned(m,/code|coding|software/i)) roles.push("Coding / Platform Utility");
  return [...new Set(roles)];
}
const candidate = (m:any,kind:"FREE"|"PAID"|"REFERENCE"|"SPECIALIST", specialist?:string) => ({
  modelId:m.provider_model_id,name:m.canonical_name,provider:m.author||"UNKNOWN",priceClass:m.price_class,
  inputUsdPerMillion:pricePerMillion(m,"prompt"),outputUsdPerMillion:pricePerMillion(m,"completion"),contextLength:m.context_length,
  capabilities:m.capabilities,evaluationState:m.evaluation_state||"NOT_EVALUATED",roles:suggestedRoles(m),
  description:String(m.description||"").slice(0,220),whyShortlisted:shortlistReasons(m,kind),benchmarkEligible:m.availability==="AVAILABLE",
  specialist:specialist||null,availability:m.availability,
});

/** Deterministic eligibility shortlist; it is deliberately not a quality ranking. */
export function buildShortlistV2(rows:any[]) {
  const available=rows.filter(m=>m.availability==="AVAILABLE"); const used=new Set<string>();
  const score=(m:any)=>(declaredCount(m)*12)+Math.min((m.context_length||0)/25000,20)+(m.capabilities?.reasoning==="DECLARED"?12:0)+(m.capabilities?.toolCalling==="DECLARED"?8:0)+(m.capabilities?.structuredOutput==="DECLARED"?8:0)+(m.capabilities?.vision==="DECLARED"?7:0);
  const family=(m:any)=>String(m.author||m.provider_model_id.split('/')[0]||"UNKNOWN").replace(/^~/,'').toLowerCase();
  const diverse=(models:any[],limit:number)=>{const families=new Set<string>(),selected:any[]=[];for(const m of models){const f=family(m);if(families.has(f))continue;families.add(f);selected.push(m);if(selected.length===limit)break;}return selected;};
  const free=diverse(available.filter(m=>m.price_class==="FREE").sort((a,b)=>score(b)-score(a)||String(a.provider_model_id).localeCompare(String(b.provider_model_id))),5); free.forEach(m=>used.add(m.provider_model_id));
  const paid=diverse(available.filter(m=>m.price_class==="PAID"&&declaredCount(m)>=2&&!used.has(m.provider_model_id)).sort((a,b)=>{
    const ac=(pricePerMillion(a,"prompt")??1e9)+(pricePerMillion(a,"completion")??1e9),bc=(pricePerMillion(b,"prompt")??1e9)+(pricePerMillion(b,"completion")??1e9); return ac-bc||score(b)-score(a);
  }),5); paid.forEach(m=>used.add(m.provider_model_id));
  const authors=new Set<string>(); const references:any[]=[];
  const referenceAuthors=new Set(["openai","anthropic","google","qwen","deepseek","x-ai","z-ai","meta-llama","mistralai"]);
  for(const m of available.filter(m=>m.price_class==="PAID"&&!used.has(m.provider_model_id)&&(m.context_length||0)>=100000&&declaredCount(m)>=3).sort((a,b)=>(referenceAuthors.has(family(b))?60:0)+score(b)-(referenceAuthors.has(family(a))?60:0)-score(a)||String(a.author).localeCompare(String(b.author)))){
    const author=family(m); if(authors.has(author))continue; authors.add(author);references.push(m);used.add(m.provider_model_id);if(references.length===4)break;
  }
  const specialistRules:[string,(m:any)=>boolean][]=[
    ["Research",m=>m.capabilities?.reasoning==="DECLARED"&&m.capabilities?.toolCalling==="DECLARED"],
    ["Script / Creative Writing",m=>positioned(m,/creative|story|writing|narrative|roleplay/i)],
    ["Structured Output",m=>m.capabilities?.structuredOutput==="DECLARED"],
    ["Vision / Multimodal",m=>m.capabilities?.vision==="DECLARED"],
    ["Coding / Platform Utility",m=>positioned(m,/code|coding|software/i)&&m.capabilities?.toolCalling==="DECLARED"],
  ];
  const specialists=specialistRules.flatMap(([role,test])=>available.filter(m=>m.price_class!=="UNKNOWN"&&test(m)).sort((a,b)=>score(b)-score(a)).slice(0,2).map(m=>candidate(m,"SPECIALIST",role)));
  return {version:"V2",selectionSemantics:"Provider-evidence compatibility, price, context, capability coverage, and provider diversity; not AMF quality ranking.",
    freeCandidates:free.map(m=>candidate(m,"FREE")),costEfficientPaidCandidates:paid.map(m=>candidate(m,"PAID")),higherCapabilityReferenceCandidates:references.map(m=>candidate(m,"REFERENCE")),specialistCandidates:specialists,
    duplicatePolicy:"Main groups are mutually exclusive. A model may repeat across specialist roles only when its provider evidence supports each role; the specialist label explains the reuse.",benchmarkStatus:"NOT_EXECUTED"};
}

export class ModelIntelligenceStore {
  constructor(private readonly pool: pg.Pool) {}
  async ingestProviderCatalog(input: { provider: string; sourceUrl: string; retrievedAt: string; models: ProviderModelInput[] }) {
    const refreshId = `model-refresh-${createHash("sha256").update(`${input.provider}:${input.retrievedAt}:${input.models.length}`).digest("hex").slice(0, 20)}`;
    const responseHash = hash(input.models); const client = await this.pool.connect();
    const changes = { NEW_MODEL: 0, REMOVED_OR_UNAVAILABLE_MODEL: 0, PRICE_CHANGED: 0, CAPABILITY_CHANGED: 0, DESCRIPTION_CHANGED: 0 };
    try { await client.query("BEGIN");
      await client.query(`INSERT INTO provider_model_catalog_refreshes (refresh_id,provider,source_url,retrieved_at,response_hash,model_count) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (refresh_id) DO NOTHING`, [refreshId,input.provider,input.sourceUrl,input.retrievedAt,responseHash,input.models.length]);
      const prior = await client.query(`SELECT provider_model_id,pricing_hash,capability_hash,description_hash FROM provider_model_catalog WHERE provider=$1`, [input.provider]);
      const before = new Map(prior.rows.map((r:any)=>[r.provider_model_id,r])); const seen = new Set<string>();
      for (const raw of input.models) { if (!raw?.id) continue; const n = normalizeProviderModel(raw); seen.add(n.providerModelId); const old = before.get(n.providerModelId);
        if (!old) changes.NEW_MODEL++; else { if(old.pricing_hash!==n.pricingHash) changes.PRICE_CHANGED++; if(old.capability_hash!==n.capabilityHash) changes.CAPABILITY_CHANGED++; if(old.description_hash!==n.descriptionHash) changes.DESCRIPTION_CHANGED++; }
        let snapshotId: string;
        const existing = await client.query(`SELECT price_snapshot_id FROM provider_model_price_snapshots WHERE provider=$1 AND provider_model_id=$2 AND pricing_hash=$3`,[input.provider,n.providerModelId,n.pricingHash]);
        if(existing.rowCount) snapshotId=existing.rows[0].price_snapshot_id; else { snapshotId=`model-price-${createHash("sha256").update(`${input.provider}:${n.providerModelId}:${n.pricingHash}`).digest("hex").slice(0,20)}`; await client.query(`INSERT INTO provider_model_price_snapshots (price_snapshot_id,provider,provider_model_id,refresh_id,retrieved_at,pricing_raw,pricing_normalized,pricing_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[snapshotId,input.provider,n.providerModelId,refreshId,input.retrievedAt,JSON.stringify(n.pricingRaw),JSON.stringify(n.pricingNormalized),n.pricingHash]); }
        await client.query(`INSERT INTO provider_model_catalog (provider,provider_model_id,canonical_slug,canonical_name,author,description,context_length,architecture,input_modalities,output_modalities,supported_parameters,capabilities,benchmark_metadata,pricing_raw,price_class,availability,source_url,retrieved_at,refresh_id,raw_metadata,content_hash,pricing_hash,capability_hash,description_hash,current_price_snapshot_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'AVAILABLE',$16,$17,$18,$19,$20,$21,$22,$23,$24) ON CONFLICT (provider,provider_model_id) DO UPDATE SET canonical_slug=EXCLUDED.canonical_slug,canonical_name=EXCLUDED.canonical_name,author=EXCLUDED.author,description=EXCLUDED.description,context_length=EXCLUDED.context_length,architecture=EXCLUDED.architecture,input_modalities=EXCLUDED.input_modalities,output_modalities=EXCLUDED.output_modalities,supported_parameters=EXCLUDED.supported_parameters,capabilities=EXCLUDED.capabilities,benchmark_metadata=EXCLUDED.benchmark_metadata,pricing_raw=EXCLUDED.pricing_raw,price_class=EXCLUDED.price_class,availability='AVAILABLE',source_url=EXCLUDED.source_url,retrieved_at=EXCLUDED.retrieved_at,refresh_id=EXCLUDED.refresh_id,raw_metadata=EXCLUDED.raw_metadata,content_hash=EXCLUDED.content_hash,pricing_hash=EXCLUDED.pricing_hash,capability_hash=EXCLUDED.capability_hash,description_hash=EXCLUDED.description_hash,current_price_snapshot_id=EXCLUDED.current_price_snapshot_id`,[input.provider,n.providerModelId,n.canonicalSlug,n.canonicalName,n.author,n.description,n.contextLength,JSON.stringify(n.architecture),JSON.stringify(n.inputModalities),JSON.stringify(n.outputModalities),JSON.stringify(n.supportedParameters),JSON.stringify(n.capabilities),n.benchmarkMetadata===null?null:JSON.stringify(n.benchmarkMetadata),JSON.stringify(n.pricingRaw),n.priceClass,input.sourceUrl,input.retrievedAt,refreshId,JSON.stringify(n.rawMetadata),n.contentHash,n.pricingHash,n.capabilityHash,n.descriptionHash,snapshotId]);
      }
      for(const id of before.keys()) if(!seen.has(id)) { changes.REMOVED_OR_UNAVAILABLE_MODEL++; await client.query(`UPDATE provider_model_catalog SET availability='UNAVAILABLE_OR_REMOVED', retrieved_at=$3, refresh_id=$4 WHERE provider=$1 AND provider_model_id=$2`,[input.provider,id,input.retrievedAt,refreshId]); }
      await client.query("COMMIT"); return { refreshId, totalModels: seen.size, changes };
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }
  async summary(provider="openrouter") { const q=await this.pool.query(`SELECT count(*) FILTER (WHERE availability='AVAILABLE')::int AS total, count(*) FILTER (WHERE availability='AVAILABLE' AND price_class='FREE')::int AS free, count(*) FILTER (WHERE availability='AVAILABLE' AND price_class='PAID')::int AS paid, count(*) FILTER (WHERE availability='AVAILABLE' AND price_class='UNKNOWN')::int AS unknown, count(*) FILTER (WHERE availability='AVAILABLE' AND COALESCE(e.state,'NOT_EVALUATED')<>'NOT_EVALUATED')::int AS evaluated, count(*) FILTER (WHERE availability='AVAILABLE' AND COALESCE(e.state,'NOT_EVALUATED')='NOT_EVALUATED')::int AS not_evaluated, max(c.retrieved_at) AS retrieved_at FROM provider_model_catalog c LEFT JOIN LATERAL (SELECT state FROM amf_model_evaluations x WHERE x.provider=c.provider AND x.provider_model_id=c.provider_model_id ORDER BY updated_at DESC LIMIT 1)e ON true WHERE c.provider=$1`,[provider]); return q.rows[0] ?? {}; }
  async query(provider="openrouter", input:ModelQuery={}) {
    const params:any[]=[provider]; const clauses=[`c.provider=$1`];
    if(input.availability!=="ALL") clauses.push(`c.availability='AVAILABLE'`);
    if(input.priceClass){params.push(input.priceClass);clauses.push(`c.price_class=$${params.length}`);}
    if(input.search){params.push(`%${input.search}%`);clauses.push(`(c.provider_model_id ILIKE $${params.length} OR c.canonical_name ILIKE $${params.length} OR c.author ILIKE $${params.length})`);}
    if(input.providerAuthor){params.push(input.providerAuthor);clauses.push(`c.author=$${params.length}`);}
    if(input.capability){params.push(input.capability);clauses.push(`c.capabilities->>$${params.length}='DECLARED'`);}
    if(input.evaluation){params.push(input.evaluation);clauses.push(`COALESCE(e.state,'NOT_EVALUATED')=$${params.length}`);}
    const sortMap={name:"c.canonical_name",provider:"c.author",inputPrice:"NULLIF(ps.pricing_raw->>'prompt','')::numeric",outputPrice:"NULLIF(ps.pricing_raw->>'completion','')::numeric",context:"c.context_length",recentlyAdded:"c.retrieved_at",recentlyChanged:"ps.retrieved_at"};
    const sort=sortMap[input.sort||"name"],direction=input.direction==="desc"?"DESC":"ASC",page=Math.max(1,input.page||1),pageSize=Math.min(100,Math.max(1,input.pageSize||25));
    const base=`FROM provider_model_catalog c LEFT JOIN provider_model_price_snapshots ps ON ps.price_snapshot_id=c.current_price_snapshot_id LEFT JOIN LATERAL (SELECT state FROM amf_model_evaluations x WHERE x.provider=c.provider AND x.provider_model_id=c.provider_model_id ORDER BY updated_at DESC LIMIT 1)e ON true WHERE ${clauses.join(" AND ")}`;
    const total=Number((await this.pool.query(`SELECT count(*) AS count ${base}`,params)).rows[0].count);
    params.push(pageSize,(page-1)*pageSize);
    const q=await this.pool.query(`SELECT c.provider_model_id,c.canonical_name,c.author,c.description,c.context_length,c.input_modalities,c.output_modalities,c.supported_parameters,c.capabilities,c.pricing_raw,ps.pricing_normalized,c.price_class,c.availability,c.retrieved_at,c.benchmark_metadata,c.current_price_snapshot_id,COALESCE(e.state,'NOT_EVALUATED') AS evaluation_state ${base} ORDER BY ${sort} ${direction} NULLS LAST,c.provider_model_id ASC LIMIT $${params.length-1} OFFSET $${params.length}`,params);
    return {models:q.rows,total,page,pageSize,totalPages:Math.max(1,Math.ceil(total/pageSize))};
  }
  async list(provider="openrouter", priceClass?: string, search?: string) { return (await this.query(provider,{priceClass:priceClass as PriceClass|undefined,search,pageSize:100})).models; }
  async providers(provider="openrouter") { return (await this.pool.query(`SELECT author,count(*)::int AS count FROM provider_model_catalog WHERE provider=$1 AND availability='AVAILABLE' GROUP BY author ORDER BY author`,[provider])).rows; }
  async detail(provider:string,modelId:string){const q=await this.pool.query(`SELECT c.*,ps.pricing_normalized,COALESCE(e.state,'NOT_EVALUATED') AS evaluation_state FROM provider_model_catalog c LEFT JOIN provider_model_price_snapshots ps ON ps.price_snapshot_id=c.current_price_snapshot_id LEFT JOIN LATERAL(SELECT state FROM amf_model_evaluations x WHERE x.provider=c.provider AND x.provider_model_id=c.provider_model_id ORDER BY updated_at DESC LIMIT 1)e ON true WHERE c.provider=$1 AND c.provider_model_id=$2`,[provider,modelId]);if(!q.rowCount)return null;const m=q.rows[0],short=await this.shortlist(provider);const memberships=[...short.freeCandidates.map(x=>["FREE",x]),...short.costEfficientPaidCandidates.map(x=>["COST_EFFICIENT_PAID",x]),...short.higherCapabilityReferenceCandidates.map(x=>["HIGH_CAPABILITY_REFERENCE",x]),...short.specialistCandidates.map(x=>[`SPECIALIST:${x.specialist}`,x])].filter(([,x]:any)=>x.modelId===modelId).map(([kind])=>kind);return {...m,suggested_roles:suggestedRoles(m),shortlist_memberships:memberships,why_shortlisted:[...new Set(["FREE","PAID","REFERENCE","SPECIALIST"].flatMap(k=>shortlistReasons(m,k as any)))]};}
  async priceHistory(provider:string,modelId?:string,limit=25){const params:any[]=[provider];let clause="p.provider=$1";if(modelId){params.push(modelId);clause+=` AND p.provider_model_id=$2`;}params.push(Math.min(100,Math.max(1,limit)));const q=await this.pool.query(`SELECT p.price_snapshot_id,p.provider_model_id,p.retrieved_at,p.pricing_raw,p.pricing_normalized,p.pricing_hash,c.canonical_name,c.availability,c.price_class,count(*) OVER(PARTITION BY p.provider_model_id) AS snapshot_count,lag(p.pricing_raw) OVER(PARTITION BY p.provider_model_id ORDER BY p.retrieved_at) AS previous_pricing FROM provider_model_price_snapshots p LEFT JOIN provider_model_catalog c ON c.provider=p.provider AND c.provider_model_id=p.provider_model_id WHERE ${clause} ORDER BY p.retrieved_at DESC LIMIT $${params.length}`,params);return q.rows;}
  async recentChanges(provider="openrouter"){const refreshes=(await this.pool.query(`SELECT refresh_id,retrieved_at,model_count,source_url FROM provider_model_catalog_refreshes WHERE provider=$1 ORDER BY retrieved_at DESC LIMIT 8`,[provider])).rows;const changed=(await this.pool.query(`SELECT c.provider_model_id,c.canonical_name,c.availability,count(p.*)::int AS price_snapshots,max(p.retrieved_at) AS latest_price_evidence FROM provider_model_catalog c LEFT JOIN provider_model_price_snapshots p ON p.provider=c.provider AND p.provider_model_id=c.provider_model_id WHERE c.provider=$1 GROUP BY c.provider_model_id,c.canonical_name,c.availability HAVING count(p.*)>1 OR c.availability<>'AVAILABLE' ORDER BY max(p.retrieved_at) DESC LIMIT 20`,[provider])).rows;return {refreshes,changed,note:changed.length?null:"NO_HISTORY_AVAILABLE"};}
  async shortlist(provider="openrouter") { const all=(await this.query(provider,{pageSize:100,availability:"ALL"})).models; let page=2; while(all.length<1000){const next=(await this.query(provider,{page,pageSize:100,availability:"ALL"})).models;if(!next.length)break;all.push(...next);page++;} return buildShortlistV2(all); }
  /** Complete current provider universe for deterministic server-side role funneling. */
  async catalog(provider="openrouter") { const all:any[]=[]; for(let page=1;page<=100;page++){const batch=(await this.query(provider,{page,pageSize:100,availability:"ALL"})).models;all.push(...batch);if(batch.length<100)break;} return all; }
}
