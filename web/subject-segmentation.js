/**
 * On-device portrait segmentation for Film Lab Pocket Studio.
 * Uses MediaPipe Tasks Vision selfie segmenter. No video frame leaves the browser.
 * The model/WASM runtime is downloaded from Google/jsDelivr on first use.
 */
const VERSION="0.10.21";
const ROOT="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@"+VERSION;
const MODEL="https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

export class SubjectSegmenter {
  constructor(width=540,height=960) {
    this.width=width;this.height=height;
    this.segmenter=null;this.pending=null;this.status="idle";this.lastTimestamp=-1;
    this.tmp=document.createElement("canvas");
    this.tmpCtx=this.tmp.getContext("2d",{willReadFrequently:true});
  }
  async load(progress=()=>{}) {
    if(this.segmenter)return this;
    if(this.pending)return this.pending;
    this.status="loading";
    this.pending=(async()=>{
      progress("Downloading on-device person segmenter…");
      const mp=await import(ROOT+"/+esm");
      const {FilesetResolver, ImageSegmenter}=mp;
      const vision=await FilesetResolver.forVisionTasks(ROOT+"/wasm");
      progress("Initializing person model…");
      // CPU delegate is the compatibility-first fallback for iOS.
      const options={
        baseOptions:{modelAssetPath:MODEL,delegate:"GPU"},
        runningMode:"VIDEO",
        outputCategoryMask:false,
        outputConfidenceMasks:true
      };
      try{
        this.segmenter=await ImageSegmenter.createFromOptions(vision,options);
      }catch(error){
        progress("Retrying in compatibility mode…");
        this.segmenter=await ImageSegmenter.createFromOptions(vision,{
          ...options,baseOptions:{modelAssetPath:MODEL,delegate:"CPU"}
        });
      }
      this.status="ready";return this;
    })().catch(e=>{this.status="failed";this.pending=null;throw e;});
    return this.pending;
  }
  segment(source,timestampMs) {
    if(!this.segmenter)return null;
    // Tasks require strictly increasing presentation timestamps, even when scrubbing backwards.
    const tick=Math.max(this.lastTimestamp+1,Math.floor(timestampMs));
    this.lastTimestamp=tick;
    const result=this.segmenter.segmentForVideo(source,tick);
    if(!result)return null;
    try{
      const masks=result.confidenceMasks;
      if(!masks || !masks.length)throw new Error("Segmentation returned no confidence masks");
      // Selfie segmenter: 0=background, 1=person.
      const person=masks.length>1?masks[1]:masks[0];
      const pixels=person.getAsFloat32Array();
      const sw=person.width, sh=person.height;
      if(!pixels?.length || pixels.length!==sw*sh)throw new Error("Bad person mask dimensions");
      if(this.tmp.width!==sw||this.tmp.height!==sh){
        this.tmp.width=sw;this.tmp.height=sh;
      }
      const frame=this.tmpCtx.createImageData(sw,sh);
      for(let i=0;i<pixels.length;i++){
        const p=4*i,v=Math.round(255*Math.min(1,Math.max(0,pixels[i])));
        frame.data[p]=v;frame.data[p+1]=v;frame.data[p+2]=v;frame.data[p+3]=255;
      }
      this.tmpCtx.putImageData(frame,0,0);
      // Inference always sees the already-cropped 9:16 display canvas.
      const out=document.createElement("canvas");out.width=this.width;out.height=this.height;
      const ctx=out.getContext("2d",{willReadFrequently:true});
      ctx.imageSmoothingEnabled=true;
      ctx.drawImage(this.tmp,0,0,this.width,this.height);
      const rgba=ctx.getImageData(0,0,this.width,this.height).data;
      const alpha=new Uint8Array(this.width*this.height);
      for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4];
      return alpha;
    }finally{
      for(const mask of result.confidenceMasks||[])mask.close?.();
      result.categoryMask?.close?.();
    }
  }
  close(){
    this.segmenter?.close?.();this.segmenter=null;this.pending=null;this.status="idle";
  }
}
