import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { VideoGenerationProvider, VideoGenerationProviderResponse, VideoGenerationRequest } from "@ai-media-factory/tool-framework";
import type { WanSupervisedExecutionRecord, WanSupervisedExecutionStore } from "@ai-media-factory/database";

export interface SupervisedWanSourceResolver {
  resolve(execution:WanSupervisedExecutionRecord):Promise<{imageBase64:string}>;
}
export interface SupervisedWanLifecycle { acknowledged(providerJobId:string):Promise<void>; generating(providerJobId:string):Promise<void> }
export type SupervisedWanProviderFactory=(execution:WanSupervisedExecutionRecord,lifecycle:SupervisedWanLifecycle)=>VideoGenerationProvider;
export interface SupervisedWanOutputPersister { persist(execution:WanSupervisedExecutionRecord,result:VideoGenerationProviderResponse):Promise<Record<string,unknown>> }

export class CanonicalWanVisualSourceResolver implements SupervisedWanSourceResolver {
  constructor(private readonly artifacts:{getArtifactById(id:string):Promise<{payload:unknown}|null>}){}
  async resolve(execution:WanSupervisedExecutionRecord):Promise<{imageBase64:string}>{
    const artifact=await this.artifacts.getArtifactById(execution.sourceVisualArtifactId);
    const payload=artifact?.payload&&typeof artifact.payload==="object"&&!Array.isArray(artifact.payload)?artifact.payload as Record<string,unknown>:null;
    const reference=payload&&typeof payload.artifactPathOrReference==="string"?payload.artifactPathOrReference:"";
    if(!reference)throw new Error("SOURCE_VISUAL_REFERENCE_MISSING");
    const bytes=reference.startsWith("data:")?Buffer.from(reference.slice(reference.indexOf(",")+1),"base64"):await readFile(reference);
    const actual=createHash("sha256").update(bytes).digest("hex");
    if(actual!==execution.sourceVisualSha256)throw new Error("SOURCE_VISUAL_SHA256_MISMATCH");
    return{imageBase64:bytes.toString("base64")};
  }
}

export class LocalCanonicalWanOutputPersister implements SupervisedWanOutputPersister {
  constructor(private readonly artifacts:{saveArtifact(value:any):Promise<void>},private readonly outputRoot=resolve("output","wan-supervised")){}
  async persist(execution:WanSupervisedExecutionRecord,result:VideoGenerationProviderResponse):Promise<Record<string,unknown>>{
    const value=typeof result.url==="string"?result.url:"";
    const comma=value.indexOf(",");
    if(!value.startsWith("data:video/")||comma<0||!value.slice(0,comma).includes(";base64"))throw new Error("WAN_VIDEO_OUTPUT_NOT_EMBEDDED");
    const bytes=Buffer.from(value.slice(comma+1),"base64");if(!bytes.length)throw new Error("WAN_VIDEO_OUTPUT_EMPTY");
    const sha256=createHash("sha256").update(bytes).digest("hex"),dir=resolve(this.outputRoot,execution.projectId),name=`${execution.wanExecutionId}-${sha256.slice(0,16)}.mp4`,path=resolve(dir,name),tmp=`${path}.tmp`;
    await mkdir(dir,{recursive:true});await writeFile(tmp,bytes);await rename(tmp,path);
    const artifactId=`art-${execution.wanExecutionId}-video`;
    await this.artifacts.saveArtifact({artifactId,workflowId:execution.workflowId,kind:"scene_video_clip",producerAgent:"supervised-wan-runtime",correlationId:execution.clientExecutionId,status:"completed",payload:{artifactId,projectId:execution.projectId,contentId:execution.contentId,sceneId:execution.sceneId,wanExecutionId:execution.wanExecutionId,providerJobId:result.jobId??null,artifactPathOrReference:path,sha256,bytes:bytes.length,provider:execution.provider,model:result.model??execution.model,proof:"PROVIDER_RESPONSE_TECHNICAL_OUTPUT"},contentType:"application/json",schemaVersion:"1.0",createdAt:new Date().toISOString(),parentArtifact:{artifactId:execution.sourceVisualArtifactId,kind:"scene_visual_artifact"}});
    return{artifactId,path,sha256,bytes:bytes.length,providerJobId:result.jobId??null};
  }
}

/** Durable one-row worker execution. This code never loops scenes or retries generate. */
export class SupervisedWanSingleSceneRunner {
  constructor(private readonly store:WanSupervisedExecutionStore,private readonly provider:VideoGenerationProvider|SupervisedWanProviderFactory,private readonly source:SupervisedWanSourceResolver,private readonly workerId:string,private readonly output?:SupervisedWanOutputPersister){}
  async runOnce():Promise<boolean>{
    const execution=await this.store.claimNext(this.workerId);if(!execution)return false;
    try{
      let acknowledged=false;
      const lifecycle:SupervisedWanLifecycle={acknowledged:async providerJobId=>{await this.store.acknowledge(execution.wanExecutionId,providerJobId);acknowledged=true},generating:async()=>{await this.store.markGenerating(execution.wanExecutionId)}};
      const provider=typeof this.provider==="function"?this.provider(execution,lifecycle):this.provider;
      const source=await this.source.resolve(execution);
      const request={prompt:String(execution.modelConfig.prompt??""),negativePrompt:typeof execution.modelConfig.negativePrompt==="string"?execution.modelConfig.negativePrompt:undefined,sourceAssetIds:[],clientExecutionId:execution.clientExecutionId,idempotencyKey:execution.idempotencyIdentity,sourceInputHash:execution.sourceVisualSha256,configurationFingerprint:typeof execution.modelConfig.configurationFingerprint==="string"?execution.modelConfig.configurationFingerprint:undefined,...execution.modelConfig,imageBase64:source.imageBase64} as unknown as VideoGenerationRequest;
      const result=await provider.generate(request);
      if(result.jobId&&!acknowledged)await lifecycle.acknowledged(result.jobId);
      try{
        const evidence=this.output?await this.output.persist(execution,result):{providerJobId:result.jobId??null,videoId:result.videoId??null,model:result.model??execution.model};
        await this.store.complete(execution.wanExecutionId,evidence);
      }catch{
        await this.store.requireManualReconciliation(execution.wanExecutionId,"OUTPUT_PERSISTENCE_OR_LEDGER_COMPLETION_FAILED");
      }
    }catch(error){
      if((error as {reconciliationRequired?:unknown}).reconciliationRequired===true)await this.store.requireManualReconciliation(execution.wanExecutionId,"SUBMISSION_ACK_AMBIGUOUS");
      else await this.store.fail(execution.wanExecutionId,error instanceof Error?error.name:"WAN_EXECUTION_FAILED");
    }
    return true;
  }
}
