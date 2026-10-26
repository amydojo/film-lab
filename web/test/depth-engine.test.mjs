import test from "node:test";
import assert from "node:assert/strict";
import {occlusionPixels,smoothstep,temporalDepth,depthMetrics} from "../depth-math.js";
import {BrowserDepthEngine} from "../depth-engine.js";
import {readFileSync} from "node:fs";

test("text passes behind a near hand but stays in front of a farther torso",()=>{
  const matte=new Uint8Array([255,255,255,0]);
  const depth=new Uint8Array([236,105,10,250]);
  const result=occlusionPixels(matte,depth,{mode:"depth",textDepth:.60,feather:.04});
  assert.deepEqual([...result],[255,0,0,0]);
  assert.deepEqual([...occlusionPixels(matte,null,{mode:"person"})],[255,255,255,0]);
  assert.deepEqual([...occlusionPixels(matte,depth,{mode:"none"})],[0,0,0,0]);
  assert.throws(()=>occlusionPixels(matte,new Uint8Array([1]),{mode:"depth"}),/dimensions/);
});
test("no model output cannot be represented as real spatial occlusion",()=>{
  const matte=new Uint8Array([255,128]);
  assert.deepEqual([...occlusionPixels(matte,null,{mode:"depth"})],[0,0]);
  assert.deepEqual([...occlusionPixels(matte,null,{mode:"depth",editorialFallback:true,textDepth:.45})],[255,128]);
});
test("motion discontinuities preserved during temporal smoothing",()=>{
  const previous=new Uint8Array([0,100,250]);
  const current=new Uint8Array([255,120,230]);
  const out=temporalDepth(previous,current,.5);
  assert.deepEqual([...out],[255,110,240]);
  assert.deepEqual(depthMetrics(new Uint8Array([0,125,245])).contrast,0);
  assert.equal(smoothstep(.4,.6,.5),.5);
});
test("inference adapter uses model prediction rather than uploading frames",async()=>{
  const image=new Uint8ClampedArray([40,40,40,255,220,220,220,255]);
  const fakeContext={
    clearRect(){},drawImage(){},
    createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
    putImageData(){},
    getImageData(){return {data:image};}
  };
  globalThis.document={createElement(tag){
    assert.equal(tag,"canvas");
    return {width:2,height:1,getContext(){return fakeContext;}};
  }};
  const engine=new BrowserDepthEngine(2,1);
  engine.runner=async()=>({depth:{width:2,height:1,channels:1,data:new Uint8Array([30,220])}});
  const output=await engine.predict({width:2,height:1});
  assert.deepEqual([...output],[40,220]);
});
test("mobile real depth UI and static bundle are wired",()=>{
  const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
  const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
  const build=readFileSync(new URL("../build.mjs",import.meta.url),"utf8");
  for(const id of ["depthAnalyze","depthAuto","depthStatus"])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(app.includes('occlusionPixels(alpha,depth'));
  assert.ok(app.includes('BrowserDepthEngine'));
  assert.ok(app.includes('await depthRunner.predict(snapshot)'));
  assert.ok(build.includes("depth-engine.js")&&build.includes("depth-math.js"));
});
