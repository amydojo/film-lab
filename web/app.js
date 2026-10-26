/* Film Lab Pocket Studio — browser-only study.
 * No network requests are made with imported files. GPU inference is NOT available here.
 * Exports a Python-compatible JSON project, not rendered video.
 */
"use strict";
import {interpolate,putKeyframe,removeKeyframe,nearestKeyframe,clampTrim} from "./timeline.js";
import {zipStore} from "./frame-pack.js";
(() => {
  const W=540,H=960,FPS=24,MAX_WEB_SECONDS=60,VERSION="film-lab-pocket-v03";
  const $=id=>document.getElementById(id);
  const canvas=$("film"),ctx=canvas.getContext("2d",{alpha:false});
  const makeCanvas=()=>{const c=document.createElement("canvas");c.width=W;c.height=H;return c;};
  const base=makeCanvas(),baseCtx=base.getContext("2d",{willReadFrequently:true});
  const glyph=makeCanvas(),glyphCtx=glyph.getContext("2d");
  const occluder=makeCanvas(),ocCtx=occluder.getContext("2d",{willReadFrequently:true});
  const matteView=makeCanvas(),matteCtx=matteView.getContext("2d");
  const depthView=makeCanvas(),depthCtx=depthView.getContext("2d");
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
  const defaultKeys=()=>[
    {frame:0,x:.51,y:.408,scale:1,rotation:0},
    {frame:120,x:.48,y:.392,scale:1.045,rotation:0},
    {frame:240,x:.52,y:.417,scale:1,rotation:0}
  ];
  const initial=()=>({text:"SPACE\nHAS MEMORY",font_size:92,depth:.45,opacity:1,
    color:"#efd9c4",occlusion:"depth",fontChoice:"editorial",fit:"cover",frame:0,
    keyframes:defaultKeys()});
  let state=initial(),view="composite",playing=true,maxFrame=240,media=null,
      sourceType="demo",frameRequest=0,lastTick=0,toastTimer=null,
      maskAsset=null,depthAsset=null,overlayCacheKey="",pointerDown=false;
  let mediaObjectUrl=null;
  let trimIn=0,trimOut=240,exportingFrames=false,exportAbort=false;
  function syncTrim(){
    [trimIn,trimOut]=clampTrim(trimIn,trimOut,maxFrame);
    $("inTime").textContent=(trimIn/FPS).toFixed(2)+"s";
    $("outTime").textContent=(trimOut/FPS).toFixed(2)+"s";
    $("totalFrames").textContent="/ "+String(maxFrame).padStart(3,"0")+" FRAMES";
  }
  let maskEngine=null,autoEnabled=false,autoLoading=false,segGeneration=0,
      segLastMediaTime=-100,segLastAt=0,segSerial=0,segmentStatus="idle",recorder=null,
      recordingStream=null,recordStopTime=0;
  const segmentationUnavailable=()=>segmentStatus==="failed";
  function setMaskStatus(message) {
    const status=$("maskStatus");
    if(status)status.textContent=message;
  }
  function syncAutoButton(){
    const button=$("autoMask");
    if(!button)return;
    button.disabled=autoLoading||sourceType==="demo";
    button.textContent=autoLoading?"LOADING MODEL…":autoEnabled?"AUTO MASK: ON":"AUTO MASK: OFF";
    button.setAttribute("aria-pressed",String(autoEnabled));
  }
  async function enableAutoMask(){
    if(sourceType==="demo")return;
    const generation=segGeneration;
    autoEnabled=true;autoLoading=true;setMaskStatus("LOADING PERSON MODEL…");
    syncAutoButton();
    try{
      if(!maskEngine) {
        const {SubjectSegmenter}=await import("./subject-segmentation.js");
        if(generation!==segGeneration)return;
        maskEngine=new SubjectSegmenter(W,H);
      }
      await maskEngine.load(message=>{if(generation===segGeneration)setMaskStatus(message.toUpperCase());});
      if(generation!==segGeneration)return;
      segmentStatus="ready";segLastMediaTime=-100;segLastAt=0;
      setMaskStatus("ON-DEVICE PERSON TRACKING READY");
      updateSourceUI();draw();
    }catch(e){
      if(generation!==segGeneration)return;
      autoEnabled=false;segmentStatus="failed";
      setMaskStatus("AUTO MASK UNAVAILABLE — IMPORT A MATTE");
      toast("Model could not load: "+e.message);
    }finally{
      if(generation===segGeneration){autoLoading=false;syncAutoButton();}
    }
  }
  function autoSegmentFrame(force=false){
    if(!autoEnabled||segmentStatus!=="ready"||!maskEngine||sourceType==="demo"||!media)return;
    const current=sourceType==="video"?media.currentTime:0;
    if(sourceType==="video"&&media.readyState<2)return;
    if(!force&&current===segLastMediaTime)return;
    if(!force&&Math.abs(current-segLastMediaTime)<.07 && segLastMediaTime>=0)return;
    if(!force&&performance.now()-segLastAt<80 && segLastMediaTime>=0)return;
    segLastAt=performance.now();
    try{
      const data=maskEngine.segment(base,performance.now());
      if(!data)return;
      // The mask is inferred from the SAME cropped 9:16 RGB as the final preview.
      maskAsset={data,id:++segSerial,name:"On-device person matte"};
      segLastMediaTime=current;overlayCacheKey="";
      setMaskStatus("PERSON MASK ACTIVE · FRAME "+String(state.frame).padStart(3,"0"));
    }catch(e){
      autoEnabled=false;segmentStatus="failed";
      setMaskStatus("SEGMENTATION FAILED — IMPORT MANUAL MATTE");
      toast("Person tracking stopped: "+e.message);
      syncAutoButton();
    }
  }
  const textTypeface=()=>state.fontChoice==="modern"
    ? "600 {size}px 'DM Sans',Arial,sans-serif"
    : state.fontChoice==="mono"?"500 {size}px 'DM Mono',monospace"
    : "{size}px 'DM Serif Display',Georgia,serif";
  const localKey=VERSION+"-draft";
  try {
    const stored=JSON.parse(localStorage.getItem(localKey)||"null");
    if(stored && typeof stored.text==="string" && Array.isArray(stored.keyframes) &&
      stored.keyframes.length && Number.isFinite(stored.depth) &&
      Number.isFinite(stored.font_size)) {
      state={...initial(),...stored,frame:0};
      state.keyframes=state.keyframes.filter(k=>Number.isFinite(k.frame) && Number.isFinite(k.x)
        && Number.isFinite(k.y) && Number.isFinite(k.scale) && Number.isFinite(k.rotation))
        .sort((a,b)=>a.frame-b.frame).slice(0,200);
      if(!state.keyframes.length)state.keyframes=defaultKeys();
    }
  }catch(_){}
  function persist(){
    try {
      const {frame,...kept}=state;
      localStorage.setItem(localKey,JSON.stringify(kept));
    }catch(_){}
  }
  function toast(message){
    const t=$("toast");t.textContent=message;t.style.display="block";
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.style.display="none",3400);
  }
  function valueAt(frame){return interpolate(state.keyframes,frame);}

  function setKey(x,y){
    state.keyframes=putKeyframe(state.keyframes,state.frame,{x:clamp(x,0,1),y:clamp(y,0,1)});
    persist();updateKeyLabel();
  }
  function updateKeyLabel(){
    const n=state.keyframes.length;
    const exact=state.keyframes.some(k=>k.frame===state.frame);
    $("keyframeStatus").textContent=(exact?"● ":"◇ ")+n+" KEYFRAME"+(n===1?"":"S");
    $("keyReadout").textContent="FRAME "+String(state.frame).padStart(3,"0")+(exact?" / SET":" / INTERPOLATED");
    $("removeKey").disabled=!exact||n<=1;
    const value=valueAt(state.frame);
    for(const [field,key] of [["keyX","x"],["keyY","y"],["keyScale","scale"],["keyRotation","rotation"]]){
      if(document.activeElement!==$(field))$(field).value=Number(value[key]).toFixed(key==="rotation"?1:3);
    }
    const ticks=$("keyTicks");
    const signature=state.keyframes.map(k=>k.frame).join(",")+":"+state.frame+":"+maxFrame;
    if(ticks.dataset.signature!==signature){
      ticks.dataset.signature=signature;ticks.replaceChildren();
      for(const key of state.keyframes){
        if(key.frame>maxFrame)continue;
        const marker=document.createElement("button");
        marker.type="button";marker.title="Keyframe "+key.frame;
        marker.className=key.frame===state.frame?"current":"";
        marker.style.left=(key.frame/Math.max(1,maxFrame)*100)+"%";
        marker.setAttribute("aria-label","Jump to keyframe "+key.frame);
        marker.addEventListener("click",()=>{pause();setFrame(key.frame);});
        ticks.append(marker);
      }
    }
    $("prevKey").disabled=nearestKeyframe(state.keyframes,state.frame,-1)===null;
    $("nextKey").disabled=nearestKeyframe(state.keyframes,state.frame,1)===null;
  }

  function drawCover(c,image){
    const iw=image.videoWidth||image.naturalWidth||image.width;
    const ih=image.videoHeight||image.naturalHeight||image.height;
    if(!iw||!ih)return;
    const s=(state.fit==="contain"?Math.min:Math.max)(W/iw,H/ih),w=iw*s,h=ih*s;
    c.drawImage(image,(W-w)/2,(H-h)/2,w,h);
  }
  function resetCanvas(c){c.clearRect(0,0,W,H);}
  function backdrop(time){
    const c=baseCtx;
    c.fillStyle="#241814";c.fillRect(0,0,W,H);
    const glow=c.createRadialGradient(W*.3,H*.28,12,W*.5,H*.5,680);
    glow.addColorStop(0,"#87573f");glow.addColorStop(.34,"#563627");
    glow.addColorStop(.75,"#211714");glow.addColorStop(1,"#110e0d");
    c.fillStyle=glow;c.fillRect(0,0,W,H);
    c.save();
    c.globalAlpha=.28;
    c.fillStyle="#ad7554";c.fillRect(49,0,3,H);
    c.fillStyle="#412f26";c.fillRect(59,0,17,H);
    c.fillStyle="#1b1614";c.fillRect(415,0,6,H);
    c.fillStyle="#a87251";c.fillRect(420,0,2,H);
    c.fillStyle="#1a1310";c.fillRect(0,H*.75,W,H*.25);
    c.strokeStyle="#b78662";c.lineWidth=.65;
    for(let i=0;i<7;i++){c.beginPath();c.moveTo(W*.5,H*.78);c.lineTo(i*110-90,H);c.stroke();}
    c.restore();
    const shaft=c.createLinearGradient(65,0,290,H);
    shaft.addColorStop(0,"#e7a57300");shaft.addColorStop(.5,"#f1ab7d12");
    shaft.addColorStop(1,"#c4734300");
    c.fillStyle=shaft;c.beginPath();c.moveTo(95,0);c.lineTo(298,0);c.lineTo(450,H);c.lineTo(112,H);c.fill();
    const shimmer=Math.sin(time*1.2)*7;
    const halo=c.createRadialGradient(245+shimmer,400,10,245+shimmer,400,300);
    halo.addColorStop(0,"#dd8c5350");halo.addColorStop(1,"#c96f3300");
    c.fillStyle=halo;c.fillRect(0,0,W,H);
  }
  // A deliberately abstract, designed synthetic figure — no generated patient/real human.
  function torsoShape(c,t){
    const sway=Math.sin(t*1.4)*4;
    c.beginPath();
    c.moveTo(182+sway,490);c.bezierCurveTo(135+sway,514,98+sway,562,82+sway,670);
    c.bezierCurveTo(64+sway,765,95+sway,904,115+sway,1045);
    c.lineTo(476+sway,1045);c.bezierCurveTo(460+sway,900,462+sway,770,445+sway,657);
    c.bezierCurveTo(434+sway,556,383+sway,510,330+sway,492);
    c.lineTo(318+sway,436);c.lineTo(200+sway,434);c.closePath();
  }
  function headShape(c,t){
    const sway=Math.sin(t*1.4)*4;
    c.beginPath();c.ellipse(262+sway,328,90,115,-.10,0,Math.PI*2);
  }
  function armShape(c,t){
    const move=Math.sin(t*2.3);
    const sway=Math.sin(t*1.4)*4;
    const elbowX=124+move*15,elbowY=700+move*36;
    const handX=318+move*100,handY=459+Math.cos(t*2.3)*54;
    c.beginPath();
    c.moveTo(137+sway,543);
    c.bezierCurveTo(69+sway,575,elbowX-22,662,elbowX,elbowY);
    c.bezierCurveTo(elbowX+75,644,handX-84,handY+54,handX,handY);
    return {handX,handY};
  }
  function renderFigure(c,t,kind,limit=1){
    const getFill=(part)=>{
      if(kind==="mask")return "#ffffff";
      if(kind==="depth")return part==="arm"?"#fafafa":"#d5d5d5";
      if(kind==="cover")return "#ffffff";
      const g=c.createLinearGradient(90,270,460,815);
      g.addColorStop(0,"#311d1a");g.addColorStop(.3,"#201714");
      g.addColorStop(.65,"#0d0e0e");g.addColorStop(1,"#241512");return g;
    };
    c.save();
    if(kind==="subject"){c.shadowColor="#a7644d";c.shadowBlur=44;}
    if(limit>=.80 && (kind!=="cover" || state.occlusion==="person" || state.depth<.80)){
      c.fillStyle=getFill("torso");torsoShape(c,t);c.fill();
      c.fillStyle=getFill("head");headShape(c,t);c.fill();
      // Neck joins head and shoulders, drawn beneath moving arm.
      const sx=Math.sin(t*1.4)*4;
      c.fillRect(220+sx,415,95,116);
    }
    if(limit>=.95 && (kind!=="cover" || state.occlusion==="person" || state.depth<.95)){
      c.strokeStyle=kind==="subject"?"#221715":getFill("arm");
      c.lineWidth=48;c.lineCap="round";c.lineJoin="round";
      const hand=armShape(c,t);c.stroke();
      c.fillStyle=kind==="subject"?"#31201b":getFill("arm");
      c.beginPath();c.ellipse(hand.handX,hand.handY,31,23,-.25,0,Math.PI*2);c.fill();
    }
    if(kind==="subject"){
      c.shadowBlur=0;
      const sx=Math.sin(t*1.4)*4;
      c.strokeStyle="#b9705330";c.lineWidth=3;c.beginPath();
      c.moveTo(177+sx,524);c.bezierCurveTo(154+sx,611,122+sx,728,120+sx,896);c.stroke();
      const rim=c.createLinearGradient(169,320,355,320);
      rim.addColorStop(0,"#fbb88836");rim.addColorStop(.65,"#b76b4710");rim.addColorStop(1,"#00000000");
      c.strokeStyle=rim;c.lineWidth=3;c.beginPath();c.ellipse(262+sx,328,91,116,-.10,1.4,4.1);c.stroke();
    }
    c.restore();
  }
  function demoSource(t){
    backdrop(t);
    renderFigure(baseCtx,t,"subject");
  }
  function setupDemoMap(t){
    resetCanvas(matteCtx);matteCtx.fillStyle="#000";matteCtx.fillRect(0,0,W,H);
    renderFigure(matteCtx,t,"mask");
    resetCanvas(depthCtx);depthCtx.fillStyle="#0e0e0e";depthCtx.fillRect(0,0,W,H);
    renderFigure(depthCtx,t,"depth");
    // For actual type visibility, matte regions are removed only if visually in front.
    resetCanvas(ocCtx);
    if(state.occlusion!=="none")renderFigure(ocCtx,t,"cover",1);
  }
  function matteData(img,alphaMode){
    const c=makeCanvas(),cc=c.getContext("2d",{willReadFrequently:true});
    drawCover(cc,img);
    const raw=cc.getImageData(0,0,W,H).data;
    const v=new Uint8Array(W*H);
    let transparency=false;
    for(let i=3;i<raw.length;i+=401*4){if(raw[i]<245){transparency=true;break;}}
    for(let i=0;i<v.length;i++){
      const p=i*4;v[i]=alphaMode&&transparency?raw[p+3]:
        Math.round(.2126*raw[p]+.7152*raw[p+1]+.0722*raw[p+2]);
    }
    return v;
  }
  function mapCacheUpdate(){
    if(sourceType==="demo")return;
    const key=[state.depth,state.occlusion,maskAsset?.id,depthAsset?.id].join(":");
    if(key===overlayCacheKey)return;
    overlayCacheKey=key;
    const a=maskAsset?.data,d=depthAsset?.data;
    resetCanvas(ocCtx);
    if(!a||state.occlusion==="none")return;
    const pixels=ocCtx.createImageData(W,H);
    for(let i=0;i<a.length;i++){
      const idx=i*4,m=a[i]/255;
      // Without actual depth maps use an explicitly labeled, controllable 2.5D
      // front/behind blend. Do not pretend to estimate geometric distance.
      const z=state.occlusion==="person"?1:!d?smooth(.28,.52,1-state.depth):
        smooth(state.depth-.05,state.depth+.05,d[i]/255);
      pixels.data[idx]=255;pixels.data[idx+1]=255;pixels.data[idx+2]=255;
      pixels.data[idx+3]=Math.round(255*m*z);
    }
    ocCtx.putImageData(pixels,0,0);
  }
  function importedMaps(){
    const a=maskAsset?.data,d=depthAsset?.data;
    for(const [c,data] of [[matteCtx,a],[depthCtx,d]]){
      resetCanvas(c);
      c.fillStyle="#101010";c.fillRect(0,0,W,H);
      if(!data)continue;
      const p=c.createImageData(W,H);
      for(let i=0;i<data.length;i++){
        const k=i*4,v=data[i];p.data[k]=v;p.data[k+1]=v;p.data[k+2]=v;p.data[k+3]=255;
      }
      c.putImageData(p,0,0);
    }
  }
  function typography(){
    resetCanvas(glyphCtx);
    const pose=valueAt(state.frame),fontSize=state.font_size*(pose.scale||1);
    const lines=state.text.trim().split("\n").slice(0,4);
    const c=glyphCtx;
    c.save();c.translate(pose.x*W,pose.y*H);c.rotate((pose.rotation||0)*Math.PI/180);
    c.textAlign="center";c.textBaseline="middle";
    c.font=textTypeface().replace("{size}",String(fontSize));
    c.fillStyle=state.color;c.globalAlpha=state.opacity;
    c.shadowColor=state.color;c.shadowBlur=12;
    const lineHeight=fontSize*.98,offset=(lines.length-1)*lineHeight/2;
    // Fit long editorial lines to the picture plane without truncation.
    lines.forEach((line,i)=>{
      const maxWidth=W*.91;
      const scale=Math.min(1,maxWidth/Math.max(1,c.measureText(line).width));
      c.save();c.translate(0,i*lineHeight-offset);c.scale(scale,1);c.fillText(line,0,0);c.restore();
    });
    c.restore();
    // Cut holes in type where matte + depth say geometry is closer.
    if(state.occlusion!=="none"){
      c.save();c.globalCompositeOperation="destination-out";
      c.drawImage(occluder,0,0);c.restore();
    }
    $("dragLabel").style.left=(pose.x*100)+"%";
    $("dragLabel").style.top=(pose.y*100)+"%";
  }
  function filmTexture(c,time){
    c.save();
    const v=c.createRadialGradient(W/2,H/2,200,W/2,H/2,630);
    v.addColorStop(0,"#00000000");v.addColorStop(.8,"#00000014");v.addColorStop(1,"#00000091");
    c.fillStyle=v;c.fillRect(0,0,W,H);
    c.globalAlpha=.08;
    let seed=Math.floor(time*9)+631;
    for(let i=0;i<320;i++){
      seed=(seed*1664525+1013904223)>>>0;const x=seed%W;
      seed=(seed*1664525+1013904223)>>>0;const y=seed%H;
      c.fillStyle=i%3?"#fff0d3":"#18100e";c.fillRect(x,y,1,1);
    }
    c.restore();
  }
  function draw(forceMask=false){
    if(!ctx)return;
    const t=state.frame/FPS;
    if(sourceType==="demo"){
      demoSource(t);setupDemoMap(t);
    }else{
      baseCtx.clearRect(0,0,W,H);
      baseCtx.fillStyle="#211b17";baseCtx.fillRect(0,0,W,H);
      if(media){
        try{
          if(sourceType==="video"&&media.readyState>=2||sourceType==="image"){
            drawCover(baseCtx,media);
          }
        }catch(_){}
      }
      autoSegmentFrame(forceMask);
      mapCacheUpdate();
    }
    if(view==="matte"){
      if(sourceType==="demo")ctx.drawImage(matteView,0,0);
      else if(maskAsset){importedMaps();ctx.drawImage(matteView,0,0);}
      else{ctx.fillStyle="#12100e";ctx.fillRect(0,0,W,H);}
      $("modeCaption").textContent=sourceType==="demo"||maskAsset?"PERSON MATTE / LIVE":"NO PERSON MASK";
    }else if(view==="depth"){
      if(sourceType==="demo")ctx.drawImage(depthView,0,0);
      else if(depthAsset){importedMaps();ctx.drawImage(depthView,0,0);}
      else{ctx.fillStyle="#12100e";ctx.fillRect(0,0,W,H);}
      $("modeCaption").textContent=sourceType==="demo"||depthAsset?"NEAR = WHITE":"NO DEPTH · 2.5D EDITORIAL CONTROL";
    }else{
      ctx.drawImage(base,0,0);
      typography();
      ctx.drawImage(glyph,0,0);
      filmTexture(ctx,t);
      const ready=sourceType==="demo"||!!maskAsset;
      $("modeCaption").textContent=state.occlusion==="none"?"FRONT / NO MASK":
        !ready?"NO MATTE · USE AUTO MASK":!depthAsset&&sourceType!=="demo"&&state.occlusion==="depth"?
        "2.5D OCCLUSION · NO TRUE DEPTH":"PERSON OCCLUSION / LIVE";
    }
    $("frameCount").textContent=String(state.frame).padStart(3,"0");
    $("timecode").textContent="00:"+String(Math.floor(t)).padStart(2,"0")+
      "."+String(Math.round((t%1)*100)).padStart(2,"0");
    $("scrub").value=state.frame;
    updateKeyLabel();
  }
  function animation(now){
    if(playing && (lastTick===0 || now-lastTick>=1000/FPS)){
      const elapsed=lastTick?now-lastTick:1000/FPS;
      lastTick=now;
      if(sourceType==="video"&&media&&media.readyState>=2){
        state.frame=clamp(Math.round(media.currentTime*FPS),0,maxFrame);
        if(recorder?.state==="recording"&&media.currentTime>=recordStopTime)recorder.stop();
        if(media.ended||media.currentTime>=maxFrame/FPS)pause();
      }else{
        state.frame=(state.frame+Math.max(1,Math.min(3,Math.round(elapsed*FPS/1000))))%(maxFrame+1);
      }
      draw();
    }
    frameRequest=requestAnimationFrame(animation);
  }
  function pause(){
    playing=false;lastTick=0;$("play").textContent="▶";
    $("play").setAttribute("aria-label","Play animation");
    if(sourceType==="video"&&media)media.pause();
  }
  async function start(){
    playing=true;lastTick=0;$("play").textContent="Ⅱ";
    $("play").setAttribute("aria-label","Pause animation");
    if(sourceType==="video"&&media){
      try{await media.play();}catch(err){pause();toast("Video playback needs a user gesture.");}
    }
  }
  function setFrame(n){
    state.frame=clamp(Math.round(n),0,maxFrame);
    if(sourceType==="video"&&media){
      segLastMediaTime=-100;
      media.currentTime=clamp(state.frame/FPS,0,Math.max(0,(media.duration||0)-.005));
    }
    draw();
  }
  function syncInputs(){
    $("copy").value=state.text;$("size").value=state.font_size;
    $("depth").value=state.depth;$("opacity").value=state.opacity;
    $("typeface").value=state.fontChoice;$("tint").value=state.color;
    $("occlusion").value=state.occlusion;
    $("fit").value=state.fit||"cover";
    $("sizeOut").textContent=String(state.font_size);
    $("depthOut").textContent=Number(state.depth).toFixed(2);
    $("opacityOut").textContent=Math.round(state.opacity*100)+"%";
    $("scrub").max=maxFrame;
  }
  function updateSourceUI(){
    const demo=sourceType==="demo",name=demo?"THE REFERENCE SHOT":
      (media?.dataset?.fileName||"LOCAL SOURCE");
    $("sourceName").textContent=name.length>33?name.slice(0,30)+"…":name;
    $("sourceDescription").textContent=demo?"Synthetic camera study / no footage uploaded":
      sourceType==="video"?"LOCAL VIDEO / NOT UPLOADED":"LOCAL IMAGE / NOT UPLOADED";
    $("sourceNotice").querySelector("p").textContent=demo?
      "This figure is procedural, not a human film sample. Try the moving-arm test, then import real footage and matching matte/depth maps.":
      !maskAsset?"Your clip stays in this browser. Tap AUTO MASK to detect the person automatically; no mask means typography is a foreground overlay.":
      !depthAsset?"Person matte ready. The depth slider is an editorial 2.5D front/behind blend, not real depth estimation. Import a matching depth map for measured spatial ordering.":
      "Matte and depth loaded for this frame. This is a static-map preview, not a temporally tracked VFX render.";
  }
  function fileImage(file){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file),image=new Image();
      image.onload=()=>{URL.revokeObjectURL(url);resolve(image);};
      image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Could not read the image."));};
      image.src=url;
    });
  }
  async function importMap(file,kind){
    if(!file)return;
    if(!file.type.startsWith("image/")){toast("Choose a PNG, JPG, or WebP map.");return;}
    try{
      const img=await fileImage(file),data=matteData(img,kind==="matte");
      if(kind==="matte")maskAsset={data,id:Date.now()+Math.random(),name:file.name};
      else depthAsset={data,id:Date.now()+Math.random(),name:file.name};
      overlayCacheKey="";
      updateSourceUI();toast((kind==="matte"?"Alpha matte":"Depth map")+" loaded locally.");
    }catch(e){toast(e.message);}
  }
  async function importSource(file){
    if(!file)return;
    pause();
    if(recorder?.state==="recording")recorder.stop();
    segGeneration++;autoEnabled=false;autoLoading=false;segmentStatus="idle";
    segLastMediaTime=-100;segLastAt=0;
    if(mediaObjectUrl){URL.revokeObjectURL(mediaObjectUrl);mediaObjectUrl=null;}
    maskAsset=null;depthAsset=null;overlayCacheKey="";
    syncAutoButton();setMaskStatus("STARTING SOURCE…");
    try{
      if(file.type.startsWith("image/")){
        media=await fileImage(file);sourceType="image";maxFrame=240;
      }else if(file.type.startsWith("video/")){
        const v=document.createElement("video");
        v.muted=true;v.playsInline=true;v.preload="auto";v.loop=false;
        mediaObjectUrl=URL.createObjectURL(file);v.src=mediaObjectUrl;
        await new Promise((resolve,reject)=>{
          v.onloadedmetadata=resolve;v.onerror=()=>reject(new Error("Video format is not supported by this browser."));
          v.load();
        });
        if(!Number.isFinite(v.duration)||v.duration<=0)throw Error("The clip has no readable duration.");
        v.onseeked=()=>{segLastMediaTime=-100;if(!exportingFrames)draw();};
        v.onloadeddata=()=>draw();
        media=v;sourceType="video";maxFrame=Math.max(1,Math.floor(Math.min(v.duration,MAX_WEB_SECONDS)*FPS));
        if(v.duration>MAX_WEB_SECONDS)toast("Showing the first 60 seconds of this clip.");
      }else throw Error("Choose an image or video file.");
      media.dataset.fileName=file.name;
      state.frame=0;$("scrub").max=maxFrame;
      trimIn=0;trimOut=maxFrame;syncTrim();
      updateSourceUI();draw();syncAutoButton();
      toast("Video loaded. Preparing automatic person masking…");
      enableAutoMask();
    }catch(e){sourceType="demo";media=null;maxFrame=240;syncAutoButton();updateSourceUI();toast(e.message);}
  }
  function recordClip(){
    if(recorder?.state==="recording"){recorder.stop();return;}
    if(sourceType!=="video"||!media){toast("Import a video before exporting a clip.");return;}
    if(typeof canvas.captureStream!=="function"||typeof MediaRecorder==="undefined"){
      toast("Video recording is not available in this browser. Use Export Frame.");return;
    }
    const types=["video/mp4;codecs=avc1.42E01E","video/mp4","video/webm;codecs=vp9","video/webm"];
    const mime=types.find(type=>MediaRecorder.isTypeSupported(type));
    if(!mime){toast("No supported video encoder. Export frames instead.");return;}
    // Capture the actual canvas composite. Browser codecs determine format and frame pacing.
    try{
      recordingStream=canvas.captureStream(FPS);
      const chunks=[];
      recorder=new MediaRecorder(recordingStream,{mimeType:mime,videoBitsPerSecond:3500000});
      recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      recorder.onerror=e=>{toast("Video recorder error: "+(e.error?.message||"unknown"));};
      recorder.onstop=()=>{
        recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;
        const recordMime=recorder.mimeType||mime,ext=recordMime.includes("mp4")?"mp4":"webm";
        if(chunks.length&&chunks.some(c=>c.size)){
          download("film-lab-composite."+ext,new Blob(chunks,{type:recordMime}));
          toast("Clip exported without source audio. Review frame rate and quality.");
        }else toast("Recorder produced no frames. Use Export Frame instead.");
        $("exportVideo").textContent="↓ EXPORT CLIP";
        $("exportVideo").disabled=false;
        recorder=null;
      };
      recorder.start(800);
      recordStopTime=Math.min(media.duration-.02,trimOut/FPS,media.currentTime+12);
      $("exportVideo").textContent="■ FINISH RECORD";
      toast("Recording the next 12s max in real time. Audio is not included.");
      start();
    }catch(e){
      recordingStream?.getTracks().forEach(t=>t.stop());recordingStream=null;recorder=null;
      toast("Recording unavailable: "+e.message);
    }
  }

  async function seekVideo(seconds){
    if(sourceType!=="video"||!media)return;
    const at=clamp(seconds,0,Math.max(0,(media.duration||0)-.004));
    if(Math.abs(media.currentTime-at)<.007&&media.readyState>=2)return;
    await new Promise((resolve,reject)=>{
      let done=false;
      const finish=error=>{
        if(done)return;done=true;clearTimeout(timer);
        media.removeEventListener("seeked",success);
        media.removeEventListener("error",fail);
        error?reject(error):resolve();
      };
      const success=()=>finish();
      const fail=()=>finish(Error("Video failed during seek"));
      const timer=setTimeout(()=>finish(Error("Video seek timed out")),6500);
      media.addEventListener("seeked",success);
      media.addEventListener("error",fail);
      try{media.currentTime=at;}catch(e){finish(e);}
    });
  }
  async function exportFramePack(){
    if(exportingFrames){exportAbort=true;return;}
    pause();
    const [first,end]=clampTrim(trimIn,trimOut,maxFrame);
    const last=Math.min(end,first+6*FPS);
    const frameNumbers=[];
    for(let i=first;i<=last;i+=2)frameNumbers.push(i);
    if(frameNumbers.at(-1)!==last)frameNumbers.push(last);
    const restore=state.frame,entries=[];
    exportingFrames=true;exportAbort=false;
    $("exportVideo").disabled=true;$("exportPng").disabled=true;
    $("exportFrames").textContent="■ CANCEL EXPORT";
    let byteCount=0;
    const manifest={
      format:"Film Lab V0.5 baked composite frame pack",
      note:"Frames already contain typography. No audio. Not a depth or alpha sequence.",
      fps:12,dimensions:[W,H],source_start_frame:first,source_end_frame:last,
      source_type:sourceType,source_name:media?.dataset?.fileName||"synthetic demo",
      original_frame_rate_assumed:FPS,
      occlusion_method:!maskAsset?"unoccluded draft":depthAsset?"imported depth":"on-device matte / 2.5D editorial",
      authoring_project:projectPayload(),frames:[]
    };
    try{
      for(let i=0;i<frameNumbers.length;i++){
        if(exportAbort)throw Error("Cancelled");
        const frame=frameNumbers[i];
        if(sourceType==="video")await seekVideo(frame/FPS);
        state.frame=frame;segLastMediaTime=-100;segLastAt=0;
        draw(true);
        const blob=await new Promise((resolve,reject)=>
          canvas.toBlob(data=>data?resolve(data):reject(Error("Cannot encode frame")),
                        "image/jpeg",.85));
        byteCount+=blob.size;
        if(byteCount>80*1024*1024)throw Error("Pack too large for mobile. Use shorter IN/OUT");
        const path="frames/"+String(i).padStart(4,"0")+".jpg";
        entries.push({name:path,data:blob});
        manifest.frames.push({path,source_frame:frame,time_seconds:frame/FPS});
        $("exportProgress").textContent="RENDERING "+(i+1)+"/"+frameNumbers.length+
          " · "+(byteCount/1048576).toFixed(1)+" MB";
        if(i%4===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
      entries.push({name:"manifest.json",data:JSON.stringify(manifest,null,2)+"\n"});
      entries.push({name:"README.txt",data:
        "Film Lab composite frames — 12 frames per second. No audio.\n"+
        "Frames are already composited. Metadata and authoring settings: manifest.json.\n"+
        "To assemble locally with FFmpeg after unzipping:\n"+
        "ffmpeg -framerate 12 -i frames/%04d.jpg -c:v libx264 -pix_fmt yuv420p output.mp4\n"});
      $("exportProgress").textContent="PACKAGING…";
      const zip=await zipStore(entries);
      download("film-lab-frames-"+String(first).padStart(4,"0")+".zip",zip);
      $("exportProgress").textContent="EXPORT READY · "+frameNumbers.length+" FRAMES";
      toast("Frame pack exported. Contains baked JPEG frames and metadata.");
    }catch(e){
      $("exportProgress").textContent=e.message;
      if(!exportAbort)toast("Frame pack: "+e.message);
    }finally{
      try{
        if(sourceType==="video")await seekVideo(restore/FPS);
        state.frame=restore;segLastMediaTime=-100;draw(true);
      }catch(_){}
      exportingFrames=false;exportAbort=false;
      $("exportVideo").disabled=false;$("exportPng").disabled=false;
      $("exportFrames").textContent="↓ FRAME PACK (.ZIP)";
    }
  }
  function download(name,blob){
    const a=document.createElement("a"),url=URL.createObjectURL(blob);
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  function projectPayload(){
    return {fps:FPS,layers:[{text:state.text||"TYPE",font:null,font_size:state.font_size,
      color:state.color,opacity:state.opacity,depth:state.depth,
      occlusion:state.occlusion,tracking:"none",
      keyframes:state.keyframes.map(k=>({...k,frame:Math.round(k.frame)}))
        .sort((a,b)=>a.frame-b.frame)}]};
  }
  function exportProject(){
    const project=projectPayload();
    download("film-lab-pocket-shot.json",
      new Blob([JSON.stringify(project,null,2)+"\n"],{type:"application/json"}));
    toast("Project JSON exported. Keep the source frames alongside it.");
  }
  function exportFrame(){
    canvas.toBlob(blob=>{
      if(blob){download("film-lab-frame-"+String(state.frame).padStart(4,"0")+".png",blob);
        toast("Current frame saved to your downloads.");}
      else toast("Frame export unavailable in this browser.");
    },"image/png");
  }
  function moveByPointer(e){
    const rect=canvas.getBoundingClientRect();
    setKey((e.clientX-rect.left)/rect.width,(e.clientY-rect.top)/rect.height);
    draw();
  }
  canvas.addEventListener("pointerdown",e=>{
    if(view!=="composite")return;
    pointerDown=true;canvas.setPointerCapture(e.pointerId);moveByPointer(e);
  });
  canvas.addEventListener("pointermove",e=>{if(pointerDown)moveByPointer(e);});
  canvas.addEventListener("pointerup",()=>{pointerDown=false;});
  canvas.addEventListener("pointercancel",()=>{pointerDown=false;});
  $("scrub").addEventListener("input",e=>{pause();setFrame(Number(e.target.value));});
  $("play").addEventListener("click",()=>{if(playing)pause();else start();});
  for(const name of ["size","depth","opacity"]){
    const field=$(name);
    field.addEventListener("input",()=>{
      state[name==="size"?"font_size":name]=Number(field.value);
      overlayCacheKey="";
      syncInputs();persist();draw();
    });
  }
  $("copy").addEventListener("input",e=>{state.text=e.target.value;persist();draw();});
  $("fit").addEventListener("change",e=>{
    state.fit=e.target.value==="contain"?"contain":"cover";
    segLastMediaTime=-100;segLastAt=0;overlayCacheKey="";
    persist();draw();
  });
  for(const [id,field,min,max] of [
    ["keyX","x",0,1],["keyY","y",0,1],["keyScale","scale",.05,6],
    ["keyRotation","rotation",-360,360]
  ]){
    $(id).addEventListener("focus",pause);
    $(id).addEventListener("change",()=>{
      const n=Number($(id).value);
      if(!Number.isFinite(n))return;
      const pose=valueAt(state.frame);
      state.keyframes=putKeyframe(state.keyframes,state.frame,{
        ...pose,[field]:clamp(n,min,max)
      });
      persist();updateKeyLabel();draw();
    });
  }
  for(const [id,direction] of [["prevKey",-1],["nextKey",1]]){
    $(id).addEventListener("click",()=>{
      const frame=nearestKeyframe(state.keyframes,state.frame,direction);
      if(frame!==null){pause();setFrame(frame);}
    });
  }
  $("removeKey").addEventListener("click",()=>{
    state.keyframes=removeKeyframe(state.keyframes,state.frame);
    persist();updateKeyLabel();draw();
  });
  $("markIn").addEventListener("click",()=>{
    trimIn=Math.min(state.frame,trimOut);syncTrim();toast("IN at "+(trimIn/FPS).toFixed(2)+"s");
  });
  $("markOut").addEventListener("click",()=>{
    trimOut=Math.max(state.frame,trimIn);syncTrim();toast("OUT at "+(trimOut/FPS).toFixed(2)+"s");
  });
  $("clearTrim").addEventListener("click",()=>{
    trimIn=0;trimOut=maxFrame;syncTrim();toast("Full shot range restored");
  });
  $("typeface").addEventListener("change",e=>{state.fontChoice=e.target.value;persist();draw();});
  $("tint").addEventListener("change",e=>{state.color=e.target.value;persist();draw();});
  $("occlusion").addEventListener("change",e=>{state.occlusion=e.target.value;overlayCacheKey="";persist();draw();});
  document.querySelectorAll("button[data-view]").forEach(b=>b.addEventListener("click",()=>{
    view=b.dataset.view;
    document.querySelectorAll("button[data-view]").forEach(btn=>{
      const active=btn===b;btn.classList.toggle("active",active);
      btn.setAttribute("aria-pressed",String(active));
    });
    draw();
  }));
  $("sourceFile").addEventListener("change",e=>importSource(e.target.files[0]));
  $("matteFile").addEventListener("change",e=>importMap(e.target.files[0],"matte"));
  $("depthFile").addEventListener("change",e=>importMap(e.target.files[0],"depth"));
  $("addKeyframe").addEventListener("click",()=>{
    const k=valueAt(state.frame);setKey(k.x,k.y);toast("Editorial position keyframed at "+state.frame+".");
  });
  $("reset").addEventListener("click",()=>{
    pause();state=initial();sourceType="demo";media=null;
    segGeneration++;autoEnabled=false;autoLoading=false;segmentStatus="idle";
    maskAsset=null;depthAsset=null;overlayCacheKey="";maxFrame=240;view="composite";
    trimIn=0;trimOut=maxFrame;syncTrim();
    syncAutoButton();setMaskStatus("DEMO MASK ACTIVE");
    if(mediaObjectUrl){URL.revokeObjectURL(mediaObjectUrl);mediaObjectUrl=null;}
    document.querySelectorAll("button[data-view]").forEach(b=>{
      b.classList.toggle("active",b.dataset.view==="composite");
      b.setAttribute("aria-pressed",String(b.dataset.view==="composite"));
    });
    syncInputs();updateSourceUI();persist();draw();toast("Reset to reference experiment.");
  });
  $("downloadProjectTop").addEventListener("click",exportProject);
  $("exportPng").addEventListener("click",exportFrame);
  $("exportVideo").addEventListener("click",recordClip);
  $("exportFrames").addEventListener("click",exportFramePack);
  $("autoMask").addEventListener("click",()=>{
    if(autoEnabled){autoEnabled=false;syncAutoButton();setMaskStatus("AUTO MASK PAUSED");}
    else enableAutoMask();
  });
  document.addEventListener("keydown",e=>{
    const tag=document.activeElement?.tagName;
    if(["INPUT","TEXTAREA","SELECT"].includes(tag))return;
    if(e.key==="ArrowLeft"){pause();setFrame(state.frame-1);}
    if(e.key==="ArrowRight"){pause();setFrame(state.frame+1);}
    if(e.code==="Space"){e.preventDefault();if(playing)pause();else start();}
  });
  document.addEventListener("visibilitychange",()=>{if(document.hidden)pause();});
  syncInputs();syncTrim();updateSourceUI();syncAutoButton();draw();document.fonts?.ready.then(()=>draw());
  frameRequest=requestAnimationFrame(animation);
})();
