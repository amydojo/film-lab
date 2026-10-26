import {mkdir,copyFile,readFile,readdir,stat} from "node:fs/promises";
import {join} from "node:path";
const required=["index.html","styles.css","app.js","subject-segmentation.js"];
const html=await readFile("index.html","utf8");
for(const target of ['href="./styles.css"','src="./app.js"','id="film"']) {
  if(!html.includes(target))throw new Error("Missing studio binding: "+target);
}
for(const file of required) {
  const s=await stat(file);if(s.size===0)throw new Error("Empty source: "+file);
}
await mkdir("dist",{recursive:true});
for(const file of required)await copyFile(file,join("dist",file));
console.log("Film Lab Pocket Studio: static production bundle ready in dist/");
