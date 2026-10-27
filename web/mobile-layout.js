/** Pure responsive state model for Film Lab's mobile workstation. */
export const DOCK_TABS=Object.freeze(["tune","type","depth","motion","export"]);
export function dockState({mobile,selected="tune"}){
  if(!DOCK_TABS.includes(selected))throw new Error("Unknown editor dock: "+selected);
  const panels=Object.fromEntries(DOCK_TABS.map(tab=>[tab,!mobile||tab===selected]));
  return {tabsVisible:Boolean(mobile),panels,selected};
}
export function shouldCompactPreview(target){
  if(!target)return false;
  const tag=target.tagName?.toUpperCase();
  const type=(target.type||"").toLowerCase();
  return tag==="TEXTAREA"||(tag==="INPUT"&&["text","number","search","email","url"].includes(type));
}
