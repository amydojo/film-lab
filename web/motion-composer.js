/** Film Lab Motion Composer V0.8: deterministic interpolation and presets. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const EASING=Object.freeze(["glide","smooth","linear","hold"]);
function cubicBezier(x1,y1,x2,y2,p){
  // 20 rounds binary search is deterministic in all browsers and render paths.
  let low=0,high=1,t=p;
  for(let i=0;i<20;i++){
    t=(low+high)/2;
    const u=1-t;
    const x=3*u*u*t*x1+3*u*t*t*x2+t*t*t;
    if(x<p)low=t;else high=t;
  }
  const u=1-t;
  return 3*u*u*t*y1+3*u*t*t*y2+t*t*t;
}
export function easingAt(progress,mode="glide"){
  const t=clamp(progress,0,1);
  if(t===0)return 0;
  if(t===1)return 1;
  switch(mode){
    case "hold":return t===1?1:0;
    case "linear":return t;
    case "smooth":return t*t*(3-2*t);
    case "glide":return cubicBezier(.45,0,.16,1,t);
    default:throw new Error("Unsupported easing "+mode);
  }
}
export function interpolateMotion(keys,frame,mode="glide"){
  if(!Array.isArray(keys)||!keys.length)throw Error("No motion keys");
  const ordered=[...keys].sort((a,b)=>a.frame-b.frame);
  if(frame<=ordered[0].frame)return {...ordered[0]};
  if(frame>=ordered[ordered.length-1].frame)return {...ordered[ordered.length-1]};
  for(let i=0;i<ordered.length-1;i++){
    const a=ordered[i],b=ordered[i+1];
    if(frame>b.frame)continue;
    const t=easingAt((frame-a.frame)/(b.frame-a.frame),a.ease||mode);
    return {frame,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,
      scale:(a.scale??1)+((b.scale??1)-(a.scale??1))*t,
      rotation:(a.rotation??0)+((b.rotation??0)-(a.rotation??0))*t};
  }
  throw Error("Bad motion interval");
}
export function dragCommit(keys,frame,position,easing="glide"){
  if(!Number.isInteger(frame)||frame<0)throw Error("Invalid frame");
  const pose=interpolateMotion(keys,frame,easing);
  const update={...pose,frame,x:clamp(position.x,0,1),y:clamp(position.y,0,1)};
  if(!Number.isFinite(position.x)||!Number.isFinite(position.y))throw Error("Bad pointer position");
  return [...keys.filter(k=>k.frame!==frame),update].sort((a,b)=>a.frame-b.frame);
}
const keyed=(frame,x,y,scale=1,rotation=0)=>({frame,x:clamp(x,.02,.98),y:clamp(y,.02,.98),scale,rotation});
export function motionPreset(name,base,maxFrame){
  if(!Number.isInteger(maxFrame)||maxFrame<1)throw Error("Invalid timeline duration");
  const center={x:clamp(base.x,0,1),y:clamp(base.y,0,1),scale:base.scale??1,rotation:base.rotation??0};
  const x=center.x,y=center.y,s=center.scale,r=center.rotation;
  const half=Math.round(maxFrame/2),quarter=Math.round(maxFrame/4);
  let entries;
  switch(name){
    case "hold":entries=[keyed(0,x,y,s,r),keyed(maxFrame,x,y,s,r)];break;
    case "drift":entries=[keyed(0,x-.075,y+.018,s*.965,r-2),keyed(maxFrame,x+.075,y-.018,s*1.035,r+2)];break;
    case "reveal":entries=[keyed(0,x,y+.16,s*.86,r),keyed(Math.round(maxFrame*.38),x,y,s,r),keyed(maxFrame,x,y,s,r)];break;
    case "orbit":entries=[
      keyed(0,x-.075,y,s*.96,r-5),keyed(quarter,x,y-.04,s,r),
      keyed(half,x+.075,y,s*1.04,r+5),
      keyed(Math.round(maxFrame*.75),x,y+.04,s,r),
      keyed(maxFrame,x-.075,y,s*.96,r-5)
    ];break;
    default:throw Error("Unknown motion preset "+name);
  }
  return entries.filter((k,i)=>i===0||k.frame>entries[i-1].frame);
}
/** Tolerant RDP: retains distinctive changes while eliminating micro-keys. */
export function simplifyMotion(keys,{maxKeys=12,tolerance=.015}={}){
  if(keys.length<=2)return [...keys];
  const sorted=[...keys].sort((a,b)=>a.frame-b.frame);
  const chosen=new Set([0,sorted.length-1]);
  function deviation(index,start,end){
    const a=sorted[start],b=sorted[end],k=sorted[index];
    const t=(k.frame-a.frame)/(b.frame-a.frame||1);
    const dx=k.x-(a.x+(b.x-a.x)*t),dy=k.y-(a.y+(b.y-a.y)*t);
    const ds=(k.scale??1)-((a.scale??1)+((b.scale??1)-(a.scale??1))*t);
    const dr=(k.rotation??0)-((a.rotation??0)+((b.rotation??0)-(a.rotation??0))*t);
    return Math.hypot(dx,dy,ds*.14,dr/720);
  }
  while(chosen.size<Math.min(maxKeys,sorted.length)){
    const sortedIndices=[...chosen].sort((a,b)=>a-b);
    let peak=0,candidate=-1;
    for(let j=0;j<sortedIndices.length-1;j++){
      const a=sortedIndices[j],b=sortedIndices[j+1];
      for(let i=a+1;i<b;i++){
        const d=deviation(i,a,b);
        if(d>peak){peak=d;candidate=i;}
      }
    }
    if(candidate<0||peak<=tolerance)break;
    chosen.add(candidate);
  }
  return [...chosen].sort((a,b)=>a-b).map(i=>sorted[i]);
}
export function motionCurveSvgPath(mode,width=240,height=74){
  const parts=[];
  for(let i=0;i<=48;i++){
    const x=i/48, y=easingAt(x,mode);
    parts.push((i?"L":"M")+(x*width).toFixed(2)+" "+((1-y)*height).toFixed(2));
  }
  return parts.join(" ");
}
