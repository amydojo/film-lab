import {DOCK_TABS,dockState,shouldCompactPreview} from "./mobile-layout.js";

const tabs=document.getElementById("dockTabs");
const scroll=document.getElementById("dockScroll");
const focus=document.getElementById("focusPreview");
const media=window.matchMedia("(max-width: 850px)");
const buttons=DOCK_TABS.map(tab=>document.getElementById("tab-"+tab));
const panels=Object.fromEntries(DOCK_TABS.map(tab=>[tab,document.getElementById("panel-"+tab)]));
let selected="tune";
let oldHeight=0;
function updateHeight(){
  const visibleHeight=Math.round(window.visualViewport?.height||window.innerHeight);
  if(Math.abs(visibleHeight-oldHeight)<2)return;
  oldHeight=visibleHeight;
  document.documentElement.style.setProperty("--phone-vh",visibleHeight+"px");
}
function render(){
  const {tabsVisible,panels:visibility}=dockState({mobile:media.matches,selected});
  document.body.classList.toggle("mobile-workstation",tabsVisible);
  tabs.hidden=!tabsVisible;
  buttons.forEach((button,index)=>{
    const name=DOCK_TABS[index];
    const active=name===selected;
    button.setAttribute("aria-selected",String(active));
    button.tabIndex=active?0:-1;
    panels[name].hidden=!visibility[name];
  });
  if(!tabsVisible){
    document.body.classList.remove("studio-focus","studio-text-entry");
    focus.setAttribute("aria-pressed","false");
    focus.textContent="↗ FOCUS";
    document.documentElement.style.removeProperty("--phone-vh");
  }else updateHeight();
}
function selectDock(name,{moveFocus=false}={}){
  if(!DOCK_TABS.includes(name))return;
  selected=name;
  // Only the controls scroll; never move the frame out of view.
  if(scroll)scroll.scrollTop=0;
  render();
  if(moveFocus)document.getElementById("tab-"+name).focus();
}
buttons.forEach((button,index)=>{
  button.addEventListener("click",()=>selectDock(DOCK_TABS[index]));
  button.addEventListener("keydown",event=>{
    let next=index;
    if(event.key==="ArrowRight")next=(index+1)%DOCK_TABS.length;
    else if(event.key==="ArrowLeft")next=(index+DOCK_TABS.length-1)%DOCK_TABS.length;
    else if(event.key==="Home")next=0;
    else if(event.key==="End")next=DOCK_TABS.length-1;
    else return;
    event.preventDefault();selectDock(DOCK_TABS[next],{moveFocus:true});
  });
});
focus.addEventListener("click",()=>{
  if(!media.matches)return;
  const enabled=document.body.classList.toggle("studio-focus");
  focus.setAttribute("aria-pressed",String(enabled));
  focus.textContent=enabled?"↙ NORMAL":"↗ FOCUS";
});
function refreshEntryState(){
  document.body.classList.toggle("studio-text-entry",
    media.matches&&shouldCompactPreview(document.activeElement));
  if(media.matches)updateHeight();
}
document.addEventListener("focusin",event=>{
  if(shouldCompactPreview(event.target)){
    document.body.classList.add("studio-text-entry");
    requestAnimationFrame(()=>{
      if(event.target?.isConnected && scroll?.contains(event.target)){
        // Avoid page/window scrolling on iOS: scroll only within the dock.
        const rect=event.target.getBoundingClientRect();
        const box=scroll.getBoundingClientRect();
        if(rect.bottom>box.bottom)scroll.scrollTop+=rect.bottom-box.bottom+14;
      }
    });
  }
});
document.addEventListener("focusout",()=>{
  window.setTimeout(refreshEntryState,0);
});
if(media.addEventListener)media.addEventListener("change",render);
else media.addListener(render);
window.visualViewport?.addEventListener("resize",updateHeight);
window.addEventListener("resize",updateHeight);
render();
