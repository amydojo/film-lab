/** Spatial occlusion math. Depth convention: 0=far / 255=nearest. */
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function smoothstep(a,b,x){
  if(!(b>a))return x>=b?1:0;
  const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);
}
export function occlusionPixels(alpha,depth,{mode="depth",textDepth=.45,feather=.05,editorialFallback=false}={}){
  if(!(alpha instanceof Uint8Array||alpha instanceof Uint8ClampedArray))
    throw new TypeError("A real subject alpha mask is required");
  if(mode==="none")return new Uint8Array(alpha.length);
  if(mode!=="person"&&mode!=="depth")throw new Error("Invalid occlusion mode");
  if(depth&&depth.length!==alpha.length)throw new Error("Depth/matte dimensions differ");
  if(!Number.isFinite(textDepth)||textDepth<0||textDepth>1)throw new Error("Text depth must be in [0,1]");
  const out=new Uint8Array(alpha.length);
  for(let i=0;i<alpha.length;i++){
    const gate=mode==="person"?1:
      depth?smoothstep(textDepth-feather,textDepth+feather,depth[i]/255):
      editorialFallback?smoothstep(.28,.52,1-textDepth):0;
    out[i]=Math.round(alpha[i]*gate);
  }
  return out;
}
export function temporalDepth(previous,current,weight=.26){
  if(!previous||previous.length!==current.length)return current;
  const out=new Uint8Array(current.length);
  for(let i=0;i<current.length;i++){
    const difference=Math.abs(current[i]-previous[i]);
    // Preserve changing silhouettes and fast limb crossings.
    out[i]=difference>76?current[i]:Math.round((1-weight)*current[i]+weight*previous[i]);
  }
  return out;
}
export function depthMetrics(depth,mask=null){
  if(!depth?.length)return {contrast:0,nearFraction:0};
  let lo=255,hi=0,n=0,near=0;
  for(let i=0;i<depth.length;i+=13){
    if(mask && mask[i]<32)continue;
    const d=depth[i];lo=Math.min(lo,d);hi=Math.max(hi,d);if(d>192)near++;n++;
  }
  return {contrast:n?(hi-lo)/255:0,nearFraction:n?near/n:0};
}
