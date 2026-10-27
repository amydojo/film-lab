import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {easingAt,interpolateMotion,dragCommit,motionPreset,simplifyMotion,motionCurveSvgPath,EASING} from "../motion-composer.js";

const keys=[{frame:0,x:.2,y:.5,scale:1,rotation:0},{frame:48,x:.8,y:.5,scale:1.4,rotation:20}];
test("motion interpolation and curve endpoints are deterministic",()=>{
  for(const style of EASING){
    assert.equal(easingAt(0,style),0);
    assert.equal(easingAt(1,style),1);
    const start=interpolateMotion(keys,0,style),end=interpolateMotion(keys,48,style);
    assert.equal(start.x,.2);assert.equal(end.x,.8);
    assert.equal(motionCurveSvgPath(style).startsWith("M"),true);
  }
  assert.equal(interpolateMotion(keys,24,"linear").x,.5);
  assert.equal(interpolateMotion(keys,24,"hold").x,.2);
  assert.ok(interpolateMotion(keys,24,"glide").x>.2);
  assert.throws(()=>easingAt(.5,"bogus"),/Unsupported/);
});
test("gesture commit creates exactly one key, even after hundreds of moves",()=>{
  let draft=keys;
  const frame=17;
  // Pointer movements use transient gesture state and must not mutate keys.
  for(let i=0;i<250;i++){
    const preview={x:.25+i/1000,y:.35};
    assert.equal(draft.length,2);
    assert.ok(preview.x<=.5);
  }
  draft=dragCommit(draft,frame,{x:.55,y:.35});
  assert.deepEqual(draft.map(k=>k.frame),[0,17,48]);
  draft=dragCommit(draft,frame,{x:.57,y:.36});
  assert.deepEqual(draft.map(k=>k.frame),[0,17,48]);
  assert.throws(()=>dragCommit(draft,frame,{x:NaN,y:.3}),/Bad pointer/);
});
test("presets are short bounded compositions, including graceful short durations",()=>{
  for(const name of ["hold","drift","reveal","orbit"]){
    const sequence=motionPreset(name,{x:.5,y:.4,scale:1,rotation:0},72);
    assert.ok(sequence.length>=2&&sequence.length<=5,name);
    assert.equal(sequence[0].frame,0);
    assert.equal(sequence.at(-1).frame,72);
    assert.ok(sequence.every(k=>k.x>=0&&k.x<=1&&k.y>=0&&k.y<=1));
    assert.ok(sequence.every((k,i)=>i===0||k.frame>sequence[i-1].frame));
  }
  assert.equal(motionPreset("orbit",{x:.5,y:.4},1).at(-1).frame,1);
  assert.throws(()=>motionPreset("bad",{x:.5,y:.4},72),/Unknown/);
});
test("refine micro-keyed paths but preserve meaningful turns",()=>{
  const hundred=Array.from({length:200},(_,i)=>({frame:i,x:.2+.6*i/199,y:.4,scale:1,rotation:0}));
  const reduced=simplifyMotion(hundred,{maxKeys:12,tolerance:.014});
  assert.equal(reduced.length,2);
  assert.equal(reduced[0].frame,0);
  assert.equal(reduced.at(-1).frame,199);
  const turn=[{frame:0,x:.2,y:.3,scale:1,rotation:0},
    {frame:50,x:.75,y:.8,scale:1,rotation:0},
    {frame:100,x:.25,y:.3,scale:1,rotation:0}];
  assert.deepEqual(simplifyMotion(turn,{maxKeys:12,tolerance:.014}),turn);
});
test("mobile motion UI actually binds live preview and editing without pointermove writes",()=>{
  const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
  const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
  const bundle=readFileSync(new URL("../build.mjs",import.meta.url),"utf8");
  for(const id of ["motionEase","motionEaseLabel","motionEasePath","undoMotion","redoMotion","cleanMotion","addKeyframe"])
    assert.ok(html.includes('id="'+id+'"'),id);
  for(const name of ["drift","reveal","orbit","hold"])
    assert.ok(html.includes('data-motion-preset="'+name+'"'),name);
  const motionStart=app.indexOf('canvas.addEventListener("pointermove"');
  const release=app.indexOf('canvas.addEventListener("pointerup"',motionStart);
  assert.ok(motionStart>0&&release>motionStart);
  assert.equal(app.slice(motionStart,release).includes("setKey("),false);
  assert.ok(app.slice(release,release+600).includes("setKey(final.x,final.y)"));
  assert.ok(app.includes('interpolateMotion(state.keyframes,frame'));
  assert.ok(app.includes('editor:{motionEase:state.motionEase'));
  assert.ok(bundle.includes('"motion-composer.js"'));
});
