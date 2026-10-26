import test from "node:test";
import assert from "node:assert/strict";
import {interpolate,putKeyframe,removeKeyframe,nearestKeyframe,clampTrim} from "../timeline.js";
import {zipStore} from "../frame-pack.js";
import {readFileSync} from "node:fs";
const keys=[
 {frame:0,x:.2,y:.3,scale:1,rotation:0},
 {frame:24,x:.8,y:.7,scale:2,rotation:90}
];

test("smooth timeline interpolation and frame boundaries",()=>{
  assert.deepEqual(interpolate(keys,-1),keys[0]);
  assert.deepEqual(interpolate(keys,25),keys[1]);
  const mid=interpolate(keys,12);
  assert.equal(mid.x,.5);
  assert.equal(mid.y,.5);
  assert.equal(mid.scale,1.5);
  assert.equal(mid.rotation,45);
});
test("upsert keyframe, no duplicate frames, nearest and deletion",()=>{
  const edited=putKeyframe(keys,12,{x:.65});
  assert.deepEqual(edited.map(k=>k.frame),[0,12,24]);
  assert.equal(putKeyframe(edited,12,{x:.68}).length,3);
  assert.equal(nearestKeyframe(edited,12,-1),0);
  assert.equal(nearestKeyframe(edited,12,1),24);
  assert.equal(nearestKeyframe(edited,24,1),null);
  assert.deepEqual(removeKeyframe(edited,12),keys);
  assert.equal(removeKeyframe([keys[0]],0).length,1);
  assert.deepEqual(clampTrim(30,5,24),[5,24]);
  assert.throws(()=>putKeyframe(keys,6,{scale:-2}),/bounds/);
});
test("offline ZIP emits correct container and CRC for a simple frame pack",async()=>{
  const blob=await zipStore([
    {name:"frames/0000.jpg",data:new Uint8Array([1,2,3,4])},
    {name:"manifest.json",data:'{"fps":12}'}
  ]);
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const dv=new DataView(bytes.buffer);
  assert.equal(dv.getUint32(0,true),0x04034b50);
  assert.equal(dv.getUint32(14,true),0xb63cfbcd); // CRC32 of 01 02 03 04
  const tail=bytes.length-22;
  assert.equal(dv.getUint32(tail,true),0x06054b50);
  assert.equal(dv.getUint16(tail+10,true),2);
  assert.equal(dv.getUint32(tail+16,true),bytes.length-
    22-dv.getUint32(tail+12,true));
  assert.equal(blob.type,"application/zip");
  await assert.rejects(()=>zipStore([{name:"../patient.jpg",data:"a"}]),/Invalid/);
});
test("mobile editor has real controls and export wiring",()=>{
  const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
  const js=readFileSync(new URL("../app.js",import.meta.url),"utf8");
  for(const id of ["prevKey","nextKey","keyX","keyY","keyRotation","keyScale",
                   "removeKey","keyTicks","markIn","markOut","exportFrames","fit"]){
    assert.ok(html.includes('id="'+id+'"'),id);
    assert.ok(js.includes('"'+id+'"'),"unwired "+id);
  }
  assert.ok(html.includes('type="module" src="./app.js"'));
  assert.ok(js.includes("await seekVideo(frame/FPS)"));
  assert.ok(js.includes("await zipStore(entries)"));
});
