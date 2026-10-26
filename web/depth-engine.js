/** Real browser depth inference: Depth Anything V2 Small ONNX.
 * Runs locally after downloading Hugging Face model files. No user frames uploaded.
 * DA3 remains the Python GPU production route.
 */
const HF="https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
const MODEL="onnx-community/depth-anything-v2-small";
export class BrowserDepthEngine {
  constructor(width=540,height=960){
    this.width=width;this.height=height;this.runner=null;this.pending=null;
    this.status="idle";this.model=MODEL;
    this.input=document.createElement("canvas");
    this.input.width=192;this.input.height=340;
    this.ctx=this.input.getContext("2d",{willReadFrequently:true});
    this.tmp=document.createElement("canvas");
    this.tmpCtx=this.tmp.getContext("2d",{willReadFrequently:true});
    this.out=document.createElement("canvas");
    this.out.width=width;this.out.height=height;
    this.outCtx=this.out.getContext("2d",{willReadFrequently:true});
  }
  async load(progress=()=>{}){
    if(this.runner)return this;
    if(this.pending)return this.pending;
    this.status="loading";
    this.pending=(async()=>{
      progress("Downloading browser depth runtime");
      const {pipeline}=await import(HF);
      progress("Downloading Depth Anything V2 Small");
      // WebGPU is opportunistic; CPU/WASM must work on older iPhones.
      try{
        if(!navigator.gpu)throw Error("No WebGPU");
        this.runner=await pipeline("depth-estimation",MODEL,{device:"webgpu",dtype:"fp32"});
        this.accelerator="webgpu";
      }catch(error){
        progress("Starting compatibility mode (CPU)");
        this.runner=await pipeline("depth-estimation",MODEL,{device:"wasm"});
        this.accelerator="wasm";
      }
      this.status="ready";return this;
    })().catch(error=>{this.pending=null;this.status="failed";throw error;});
    return this.pending;
  }
  async predict(source){
    if(!this.runner)throw Error("Depth estimator not loaded");
    this.ctx.clearRect(0,0,this.input.width,this.input.height);
    this.ctx.drawImage(source,0,0,this.input.width,this.input.height);
    // Transformers.js accepts HTMLCanvasElement. Its 'depth' is a relative 8-bit
    // single-channel near-bright image, not physical distances.
    const prediction=await this.runner(this.input);
    const raw=Array.isArray(prediction)?prediction[0]:prediction;
    const d=raw?.depth;
    if(!d||!d.width||!d.height||!d.data)throw Error("Depth model produced no image");
    const channels=d.channels||1;
    if(channels!==1&&channels!==3&&channels!==4)throw Error("Unknown depth channel count");
    this.tmp.width=d.width;this.tmp.height=d.height;
    const img=this.tmpCtx.createImageData(d.width,d.height);
    for(let i=0;i<d.width*d.height;i++){
      const rawValue=d.data[i*channels];
      const v=Math.round(Math.max(0,Math.min(255,rawValue)));
      const p=i*4;img.data[p]=v;img.data[p+1]=v;img.data[p+2]=v;img.data[p+3]=255;
    }
    this.tmpCtx.putImageData(img,0,0);
    this.outCtx.clearRect(0,0,this.width,this.height);
    this.outCtx.imageSmoothingEnabled=true;
    this.outCtx.imageSmoothingQuality="high";
    this.outCtx.drawImage(this.tmp,0,0,this.width,this.height);
    const pixels=this.outCtx.getImageData(0,0,this.width,this.height).data;
    const out=new Uint8Array(this.width*this.height);
    for(let i=0;i<out.length;i++)out[i]=pixels[i*4];
    return out;
  }
  close(){this.runner?.dispose?.();this.runner=null;this.pending=null;this.status="idle";}
}
