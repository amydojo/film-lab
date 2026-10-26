/** Deterministic editorial keyframes, independent of canvas and media state. */
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export function interpolate(keys,frame){
  if(!keys?.length)throw Error("Missing keyframes");
  const sorted=[...keys].sort((a,b)=>a.frame-b.frame);
  if(frame<=sorted[0].frame)return {...sorted[0]};
  if(frame>=sorted[sorted.length-1].frame)return {...sorted[sorted.length-1]};
  for(let i=0;i<sorted.length-1;i++){
    const a=sorted[i],b=sorted[i+1];
    if(frame<=b.frame){
      let t=(frame-a.frame)/(b.frame-a.frame);
      t=t*t*(3-2*t);
      const left={scale:1,rotation:0,...a},right={scale:1,rotation:0,...b};
      return {frame,x:left.x+(right.x-left.x)*t,y:left.y+(right.y-left.y)*t,
        scale:left.scale+(right.scale-left.scale)*t,
        rotation:left.rotation+(right.rotation-left.rotation)*t};
    }
  }
  throw Error("Frame interpolation failure");
}
export function putKeyframe(keys,frame,updates={}){
  if(!Number.isInteger(frame)||frame<0)throw Error("Invalid frame");
  const value={...interpolate(keys,frame),frame,...updates};
  for(const field of ["x","y","scale","rotation"]){
    if(!Number.isFinite(value[field]))throw Error("Invalid "+field);
  }
  if(value.scale<=0||value.x<0||value.x>1||value.y<0||value.y>1)
    throw Error("Keyframe exceeds spatial bounds");
  const filtered=keys.filter(k=>k.frame!==frame);
  return [...filtered,value].sort((a,b)=>a.frame-b.frame);
}
export function removeKeyframe(keys,frame){
  if(keys.length<=1)return keys;
  const filtered=keys.filter(k=>k.frame!==frame);
  return filtered.length?filtered:keys;
}
export function nearestKeyframe(keys,frame,direction){
  if(direction!==-1&&direction!==1)throw Error("Direction must be -1 or 1");
  const candidates=keys.map(k=>k.frame).filter(f=>direction===1?f>frame:f<frame);
  return candidates.length?(direction===1?Math.min(...candidates):Math.max(...candidates)):null;
}
export function clampTrim(start,end,maxFrame){
  const i=clamp(Math.round(start),0,maxFrame),o=clamp(Math.round(end),0,maxFrame);
  return [Math.min(i,o),Math.max(i,o)];
}
