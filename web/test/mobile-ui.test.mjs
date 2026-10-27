import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dockState,DOCK_TABS,shouldCompactPreview} from "../mobile-layout.js";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../styles.css",import.meta.url),"utf8");
const ui=readFileSync(new URL("../mobile-ui.js",import.meta.url),"utf8");
const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");

test("phone shows exactly one editing tab at a time, desktop shows every group",()=>{
  for(const selected of DOCK_TABS){
    const mobile=dockState({mobile:true,selected});
    assert.equal(Object.values(mobile.panels).filter(Boolean).length,1);
    assert.equal(mobile.panels[selected],true);
    assert.equal(mobile.tabsVisible,true);
    const desktop=dockState({mobile:false,selected});
    assert.ok(Object.values(desktop.panels).every(Boolean));
    assert.equal(desktop.tabsVisible,false);
  }
  assert.throws(()=>dockState({mobile:true,selected:"invalid"}),/Unknown/);
});
test("focus handling compacts monitor only for actual keyboard fields",()=>{
  assert.equal(shouldCompactPreview({tagName:"TEXTAREA"}),true);
  assert.equal(shouldCompactPreview({tagName:"INPUT",type:"number"}),true);
  assert.equal(shouldCompactPreview({tagName:"INPUT",type:"range"}),false);
  assert.equal(shouldCompactPreview({tagName:"BUTTON"}),false);
});
test("editor controls are unique, grouped, and still wired to original app state",()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,"No duplicate DOM IDs permitted");
  for(const id of ["film","depth","size","opacity","copy","autoMask","depthAnalyze",
                   "keyX","keyY","keyRotation","keyScale","exportFrames","markIn","markOut"]){
    assert.ok(ids.includes(id),id+" missing");
  }
  for(const tab of DOCK_TABS){
    assert.ok(html.includes('id="panel-'+tab+'"'),"missing panel "+tab);
    assert.ok(html.includes('aria-controls="panel-'+tab+'"'),"missing tab link "+tab);
    assert.ok(ui.includes('"tab-"+tab'),"mobile tab UI missing");
  }
  assert.ok(html.includes('<script type="module" src="./mobile-ui.js"></script>'));
  assert.ok(html.includes('id="dockScroll"'));
  assert.ok(app.includes('$("depth")')||app.includes('"size","depth","opacity"'));
});
test("mobile monitor uses fixed app viewport, internal dock scroller, keyboard adjustment",()=>{
  assert.ok(css.includes("height:calc(var(--phone-vh,100dvh) - 52px)"));
  assert.ok(css.includes(".studio-dock-scroll{display:block"));
  assert.ok(css.includes("overflow-y:auto"));
  assert.ok(css.includes("body.studio-text-entry .preview-area"));
  assert.ok(css.includes("body.studio-focus .preview-area"));
  assert.ok(ui.includes('window.visualViewport?.addEventListener("resize"'));
  assert.ok(ui.includes("scroll.scrollTop=0"));
});
