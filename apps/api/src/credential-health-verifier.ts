/** Provider-specific credential verification behind the provider-neutral Owner
 * control action.  Secrets stay in memory and only safe classifications leave
 * this module.  Tests inject a verifier and perform no network I/O. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  readCredential, refreshAccessToken, verifyChannel, credentialStatus,
  YOUTUBE_OAUTH_SCOPES,
} from "@ai-media-factory/provider-adapters";
import type { OAuthTransport } from "@ai-media-factory/provider-adapters";
import type { CredentialHealthVerifier, CredentialHealthVerificationInput } from "./owner-autonomy-api.js";
import type { CredentialHealthTransportEvent, SafeCredentialHealthResult } from "@ai-media-factory/database";

const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const fingerprint=(parts:unknown[])=>createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const freshness=(verifiedAt:string)=>new Date(Date.parse(verifiedAt)+24*60*60*1000).toISOString();

type FetchResponse = { ok:boolean; status:number; json():Promise<unknown> };
type FetchLike = (url:string,init?:Record<string,unknown>)=>Promise<FetchResponse>;
type TransportStage = "OAUTH_REFRESH" | "YOUTUBE_IDENTITY";

class SafeTransportError extends Error {
  constructor(readonly stage:TransportStage,readonly httpStatus:number|undefined,
    readonly providerErrorCode:string,readonly retryable:boolean,readonly errorClass:string){super(providerErrorCode)}
}

const safeProviderCode=(value:unknown):string=>typeof value==="string"&&/^[A-Za-z0-9_.-]{1,80}$/.test(value)
  ? value.toUpperCase() : "UNKNOWN_PROVIDER_ERROR";
const record=(ledger:CredentialHealthTransportEvent[],event:CredentialHealthTransportEvent)=>ledger.push(event);

export class ProductionCredentialHealthVerifier implements CredentialHealthVerifier {
  constructor(private readonly fetchImpl:FetchLike=fetch as unknown as FetchLike){}

  private async providerJson(stage:TransportStage,url:string,init:Record<string,unknown>):Promise<{payload:unknown;status:number}>{
    let response:FetchResponse;
    try{response=await this.fetchImpl(url,init)}catch(error){
      throw new SafeTransportError(stage,undefined,"NETWORK_ERROR",true,error instanceof Error?error.name:"UNKNOWN_ERROR");
    }
    let payload:unknown;
    try{payload=await response.json()}catch{
      throw new SafeTransportError(stage,response.status,"INVALID_JSON_RESPONSE",false,"RESPONSE_PARSE_ERROR");
    }
    if(!response.ok){
      const body=payload!==null&&typeof payload==="object"&&!Array.isArray(payload)?payload as Record<string,unknown>:{};
      throw new SafeTransportError(stage,response.status,safeProviderCode(body.error),response.status===429||response.status>=500,"PROVIDER_HTTP_ERROR");
    }
    return {payload,status:response.status};
  }

  async verify(input:CredentialHealthVerificationInput):Promise<SafeCredentialHealthResult>{
    const verifiedAt=new Date().toISOString();
    const transportLedger:CredentialHealthTransportEvent[]=[];
    if(input.provider!=="youtube")return {state:"ERROR" as const,scopeState:"UNKNOWN" as const,channelIdentityState:"UNKNOWN" as const,reasonCode:"CREDENTIAL_PROVIDER_UNSUPPORTED",evidenceFingerprint:fingerprint([input.provider,"unsupported",verifiedAt]),verifiedAt,freshUntil:freshness(verifiedAt)};
    const resolved=path.resolve(input.credentialReference);
    const relative=path.relative(repositoryRoot,resolved);
    if(relative===""||(!relative.startsWith("..")&&!path.isAbsolute(relative)))return {state:"AUTH_REQUIRED" as const,scopeState:"UNKNOWN" as const,channelIdentityState:"UNKNOWN" as const,reasonCode:"CREDENTIAL_REFERENCE_MUST_BE_EXTERNAL",evidenceFingerprint:fingerprint([input.provider,"repo-path",verifiedAt]),verifiedAt,freshUntil:freshness(verifiedAt)};
    record(transportLedger,{stage:"CREDENTIAL_REF_RESOLVED",outcome:"SUCCEEDED",at:new Date().toISOString()});
    let credential;
    try{credential=await readCredential({readFile:(p)=>readFile(p,"utf8")},resolved)}catch(error){
      record(transportLedger,{stage:"TOKEN_FILE_READ",outcome:"FAILED",at:new Date().toISOString(),errorClass:error instanceof Error?error.name:"UNKNOWN_ERROR",retryable:false});
      return {state:"AUTH_REQUIRED",scopeState:"UNKNOWN",channelIdentityState:"UNKNOWN",reasonCode:"CREDENTIAL_UNAVAILABLE_OR_MALFORMED",evidenceFingerprint:fingerprint([input.provider,"AUTH_REQUIRED",verifiedAt]),verifiedAt,freshUntil:freshness(verifiedAt),transportLedger};
    }
    record(transportLedger,{stage:"TOKEN_FILE_READ",outcome:"SUCCEEDED",at:new Date().toISOString()});
    const metadata=credentialStatus(credential);
    const scopePass=YOUTUBE_OAUTH_SCOPES.every((scope)=>metadata.scopes.includes(scope));
    record(transportLedger,{stage:"SCOPE_VALIDATION",outcome:scopePass?"SUCCEEDED":"FAILED",at:new Date().toISOString(),retryable:false});
    if(!scopePass)return {state:"INSUFFICIENT_SCOPE",scopeState:"FAIL",channelIdentityState:"UNKNOWN",reasonCode:"REQUIRED_SCOPE_MISSING",evidenceFingerprint:fingerprint([input.provider,[...metadata.scopes].sort(),"scope-fail",verifiedAt]),verifiedAt,freshUntil:freshness(verifiedAt),transportLedger};

    let refreshStatus:number|undefined;
    const transport:OAuthTransport={
      postForm:async(url,params)=>{const r=await this.providerJson("OAUTH_REFRESH",url,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(params)});refreshStatus=r.status;return r.payload},
      get:async(url,headers)=>{const r=await this.providerJson("YOUTUBE_IDENTITY",url,{headers});return r.payload},
    };
    record(transportLedger,{stage:"OAUTH_REFRESH",outcome:"STARTED",at:new Date().toISOString()});
    let refreshed;
    try{refreshed=await refreshAccessToken(transport,credential)}catch(error){
      const safe=error instanceof SafeTransportError?error:null;
      const providerErrorCode=safe?.providerErrorCode??(error instanceof Error&&error.message==="OAUTH_REFRESH_INCOMPLETE"?"ACCESS_TOKEN_NOT_RETURNED":"OAUTH_REFRESH_FAILED");
      record(transportLedger,{stage:"OAUTH_REFRESH",outcome:"FAILED",at:new Date().toISOString(),httpStatus:safe?.httpStatus??refreshStatus,providerErrorCode,errorClass:safe?.errorClass??(error instanceof Error?error.name:"UNKNOWN_ERROR"),retryable:safe?.retryable??false});
      return {state:"ERROR",scopeState:"PASS",channelIdentityState:"UNKNOWN",reasonCode:safe?"OAUTH_REFRESH_HTTP_ERROR":"OAUTH_REFRESH_RESPONSE_INVALID",evidenceFingerprint:fingerprint([input.provider,"ERROR",providerErrorCode,verifiedAt]),verifiedAt,freshUntil:freshness(verifiedAt),transportLedger};
    }
    record(transportLedger,{stage:"OAUTH_REFRESH",outcome:"SUCCEEDED",at:new Date().toISOString(),httpStatus:refreshStatus});
    record(transportLedger,{stage:"YOUTUBE_IDENTITY",outcome:"STARTED",at:new Date().toISOString()});
    let channel;
    try{channel=await verifyChannel(transport,refreshed.accessToken)}catch(error){
      const safe=error instanceof SafeTransportError?error:null;
      const providerErrorCode=safe?.providerErrorCode??(error instanceof Error&&error.message==="OAUTH_CHANNEL_UNRESOLVED"?"CHANNEL_NOT_RETURNED":"YOUTUBE_IDENTITY_FAILED");
      record(transportLedger,{stage:"YOUTUBE_IDENTITY",outcome:"FAILED",at:new Date().toISOString(),httpStatus:safe?.httpStatus,providerErrorCode,errorClass:safe?.errorClass??(error instanceof Error?error.name:"UNKNOWN_ERROR"),retryable:safe?.retryable??false});
      return {state:"ERROR",scopeState:"PASS",channelIdentityState:"UNKNOWN",reasonCode:safe?"YOUTUBE_IDENTITY_HTTP_ERROR":"YOUTUBE_IDENTITY_RESPONSE_INVALID",evidenceFingerprint:fingerprint([input.provider,"ERROR",providerErrorCode,verifiedAt]),verifiedAt,freshUntil:freshness(verifiedAt),transportLedger};
    }
    record(transportLedger,{stage:"YOUTUBE_IDENTITY",outcome:"SUCCEEDED",at:new Date().toISOString()});
    const match=channel.channelId===input.expectedExternalChannelId;
    record(transportLedger,{stage:"CHANNEL_IDENTITY_VALIDATION",outcome:match?"SUCCEEDED":"FAILED",at:new Date().toISOString(),retryable:false});
    return {state:match?"VALID":"CHANNEL_IDENTITY_MISMATCH",scopeState:"PASS",channelIdentityState:match?"MATCH":"MISMATCH",verifiedExternalChannelId:channel.channelId,reasonCode:match?"VERIFIED":"CHANNEL_IDENTITY_MISMATCH",evidenceFingerprint:fingerprint([input.provider,input.expectedExternalChannelId,channel.channelId,[...metadata.scopes].sort(),verifiedAt]),verifiedAt,freshUntil:freshness(verifiedAt),transportLedger};
  }
}
