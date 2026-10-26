/** Tiny offline ZIP32 'store' writer. No upload or third-party dependency. */
const utf8=new TextEncoder();
let table=null;
function crc32(bytes) {
  if(!table){
    table=new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
      table[i]=c>>>0;
    }
  }
  let crc=0xffffffff;
  for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
function write16(view,off,value){view.setUint16(off,value,true);}
function write32(view,off,value){view.setUint32(off,value,true);}
function concat(parts,size){
  const out=new Uint8Array(size);let index=0;
  for(const item of parts){out.set(item,index);index+=item.length;}
  return out;
}
/** All entries must be byte arrays or Blob. Output is an actual ZIP32 Blob. */
export async function zipStore(entries){
  if(!entries.length||entries.length>200)throw Error("Pack requires 1–200 entries");
  const parts=[],central=[],paths=new Set();
  let offset=0,total=0;
  for(const entry of entries){
    const name=entry.name;
    if(!name||name.startsWith("/")||name.includes("..")||name.includes("\\")||paths.has(name))
      throw Error("Invalid or duplicate archive path");
    paths.add(name);
    const path=utf8.encode(name);
    if(path.length>65535)throw Error("Archive filename too long");
    let bytes=entry.data instanceof Blob
      ?new Uint8Array(await entry.data.arrayBuffer())
      :entry.data instanceof Uint8Array?entry.data:utf8.encode(String(entry.data));
    if(bytes.length>0xffffffff||offset+bytes.length>0x7fffffff)
      throw Error("Shot pack too large");
    total+=bytes.length;
    const crc=crc32(bytes);
    const local=new Uint8Array(30+path.length),lv=new DataView(local.buffer);
    write32(lv,0,0x04034b50);write16(lv,4,20);write16(lv,6,0x0800);
    write16(lv,8,0);write16(lv,10,0);write16(lv,12,0);
    write32(lv,14,crc);write32(lv,18,bytes.length);write32(lv,22,bytes.length);
    write16(lv,26,path.length);write16(lv,28,0);local.set(path,30);
    const cd=new Uint8Array(46+path.length),cv=new DataView(cd.buffer);
    write32(cv,0,0x02014b50);write16(cv,4,20);write16(cv,6,20);
    write16(cv,8,0x0800);write16(cv,10,0);write16(cv,12,0);write16(cv,14,0);
    write32(cv,16,crc);write32(cv,20,bytes.length);write32(cv,24,bytes.length);
    write16(cv,28,path.length);write16(cv,30,0);write16(cv,32,0);
    write16(cv,34,0);write16(cv,36,0);write32(cv,38,0);write32(cv,42,offset);
    cd.set(path,46);
    parts.push(local,bytes);central.push(cd);
    offset+=local.length+bytes.length;
  }
  const centralSize=central.reduce((sum,p)=>sum+p.length,0);
  const footer=new Uint8Array(22),v=new DataView(footer.buffer);
  write32(v,0,0x06054b50);write16(v,4,0);write16(v,6,0);
  write16(v,8,entries.length);write16(v,10,entries.length);
  write32(v,12,centralSize);write32(v,16,offset);write16(v,20,0);
  // Blob accepts arrays directly; avoid another full-memory copy on phones.
  return new Blob([...parts,...central,footer],{type:"application/zip"});
}
