import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SubjectSegmenter} from "../subject-segmentation.js";

test("person confidence channel is used and inference timestamps stay monotonic",()=>{
  let closed=0;
  globalThis.document={
    createElement(tag){
      assert.equal(tag,"canvas");
      return {
        width:2,height:2,
        getContext(){return {
          createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
          putImageData(){},
          drawImage(){},
          getImageData(){return {data:new Uint8ClampedArray([
            32,32,32,255,255,255,255,255,140,140,140,255,0,0,0,255
          ])};}
        };}
      };
    }
  };
  const engine=new SubjectSegmenter(2,2);
  const stamps=[];
  const mask=(values)=>({
    width:2,height:2,
    getAsFloat32Array(){return new Float32Array(values);},
    close(){closed++;}
  });
  engine.segmenter={
    segmentForVideo(_source,stamp){
      stamps.push(stamp);
      return {confidenceMasks:[mask([.9,.8,.7,.6]),mask([.1,.2,.8,.9])]};
    }
  };
  assert.deepEqual([...engine.segment({},1000)],[32,255,140,0]);
  assert.deepEqual([...engine.segment({},800)],[32,255,140,0]);
  assert.ok(stamps[1]>stamps[0]);
  assert.equal(closed,4);
});

test("site wiring includes real-video segmentation and recorder controls",()=>{
  const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
  const js=readFileSync(new URL("../app.js",import.meta.url),"utf8");
  for(const id of ["autoMask","maskStatus","exportVideo","sourceFile","play","scrub"])
    assert.ok(html.includes('id="'+id+'"'),id);
  for(const expected of ["enableAutoMask();","autoSegmentFrame();","new MediaRecorder(","subject-segmentation.js","maskAsset={data"])
    assert.ok(js.includes(expected),expected);
  assert.ok(html.includes('width="540" height="960"'));
});
