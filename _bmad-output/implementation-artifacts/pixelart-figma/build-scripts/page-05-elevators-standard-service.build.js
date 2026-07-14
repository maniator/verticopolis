
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const root=await figma.getNodeByIdAsync("62:3");
await figma.setCurrentPageAsync(root.parent);
await figma.loadFontAsync({family:"Inter",style:"Bold"});await figma.loadFontAsync({family:"Inter",style:"Semi Bold"});await figma.loadFontAsync({family:"Inter",style:"Regular"});
function shd(h,a){const n=parseInt(h.slice(1),16);const c=v=>Math.max(0,Math.min(255,v+a));const r=c((n>>16)&255),g=c((n>>8)&255),b=c(n&255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
function glow(A,cx,cy,c){[[4,0.1],[3,0.16],[2,0.3],[1,0.6]].forEach(s=>F(A,cx-s[0],cy-s[0],s[0]*2,s[0]*2,c,s[1]));}
const DIG={1:[[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],2:[[1,1,1],[0,0,1],[1,1,1],[1,0,0],[1,1,1]],3:[[1,1,1],[0,0,1],[1,1,1],[0,0,1],[1,1,1]]};
function digit(A,x,y,d,col){const p=DIG[d];if(!p)return;for(let r=0;r<5;r++)for(let c=0;c<3;c++)if(p[r][c])F(A,x+c,y+r,1,1,col);}
// walker ~18px (queue + car passengers)
function pw(A,x,f,sh){const head=4,body=10,leg=4;F(A,x-1,f,7,1,'#000000',0.25);F(A,x+1,f-leg,2,leg,'#2A2E38');F(A,x+4,f-leg,2,leg,'#2A2E38');F(A,x,f-leg-body,6,body,sh);F(A,x,f-leg-body,1,body,shd(sh,-26));F(A,x+5,f-leg-body,1,body,shd(sh,16));F(A,x+1,f-leg-body-head,4,head,'#E8C9A0');F(A,x+1,f-leg-body-head,4,1,'#3A2E28');F(A,x+3,f-leg-body-head+1,1,1,'#F0D8B8');}
function render(name,gx,gy,tiles,floors,fn){const PS=3,W=tiles*11,H=floors*44,A=[];fn(A,W,H);const sc=figma.createFrame();sc.name=name;sc.resize(W*PS,H*PS);sc.clipsContent=true;sc.cornerRadius=3;sc.fills=[{type:'SOLID',color:hex('#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.45},offset:{x:0,y:2},radius:8,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});}
function annotate(name,cap,x,y,w){const t=figma.createText();t.fontName={family:'Inter',style:'Semi Bold'};t.fontSize=13;t.characters=name;t.fills=[{type:'SOLID',color:hex('#F4F0E4')}];root.appendChild(t);t.x=x;t.y=y;const c=figma.createText();c.fontName={family:'Inter',style:'Regular'};c.fontSize=11;c.characters=cap;c.fills=[{type:'SOLID',color:hex('#9AA4B4')}];c.textAutoResize='HEIGHT';root.appendChild(c);c.resize(Math.max(w||300,240),56);c.x=x;c.y=y+16;}
// queue of N tracked sims on a deck, facing the shaft; first content, later amber, last red
function queue(A,x,dir,deckY,n){const cols=['#5A6E8C','#3F8C84','#6E5A4A','#D8B05A','#8A94A8','#9A5FB0'];for(let i=0;i<n;i++){let sh=cols[i%cols.length];if(i>=n-1&&n>=4)sh='#C24A3A';else if(i>=n-2&&n>=3)sh='#E8862A';pw(A,x+dir*i*7,deckY,sh);}}
function elevator(A,W,H,kind){const glass=kind==='express';const shaftW=glass?66:44;const shaftX=Math.round((W-shaftW)/2);const fH=44;
  // adjacent corridors (real floors people wait on)
  for(let f=0;f<3;f++){const fb=f*fH;const deckY=fb+fH-6;for(const seg of [[0,shaftX-1],[shaftX+shaftW+1,W-(shaftX+shaftW+1)]]){const sx=seg[0],sw=seg[1];F(A,sx,fb,sw,fH,'#DAD1BA');F(A,sx,fb,sw,1,'#C6B999');F(A,sx,fb+1,sw,1,'#E4DCC6');F(A,sx,deckY,sw,6,'#B2A688');F(A,sx,deckY,sw,1,'#C6BA9C');F(A,sx,deckY+5,sw,1,'#9A8E72');}F(A,0,fb,W,1,'#8A8068',0.5);}
  // shaft body
  F(A,shaftX,0,shaftW,H, glass?'#8FB6C8':(kind==='service'?'#33302A':'#2B2620'), glass?0.16:1);
  F(A,shaftX,0,1,H,'#141118');F(A,shaftX+shaftW-1,0,1,H,'#141118');
  F(A,shaftX+3,0,2,H, glass?'#5A6472':'#3A3630');F(A,shaftX+shaftW-5,0,2,H, glass?'#5A6472':'#3A3630');
  F(A,shaftX+2,0,shaftW-4,5,'#3A3E44');F(A,shaftX+2,0,shaftW-4,1,'#4E545C'); // motor
  // floor numbers + stop lines
  for(let f=0;f<3;f++){const fb=f*fH;const num=3-f;const stops=glass?(num===1||num===3):true;if(stops)F(A,shaftX+2,fb+3,shaftW-4,1,'#FFFFFF',0.10);digit(A,shaftX+shaftW-8,fb+5,num, glass?'#3A4E5E':'#7A7468');}
  // car
  const carFloor=glass?0:1; const carFb=carFloor*fH; const carY=carFb+5; const carH=fH-9;
  F(A,shaftX+Math.round(shaftW/2)-3,5,1,carY-5,'#5A5A5A');F(A,shaftX+Math.round(shaftW/2)+2,5,1,carY-5,'#5A5A5A');
  F(A,shaftX+3,carY,shaftW-6,carH,kind==='service'?'#54584C':'#4A4238');F(A,shaftX+3,carY,shaftW-6,1,'#6A6E62');
  F(A,shaftX+5,carY+2,shaftW-10,carH-4,kind==='service'?'#7C8072':'#6B4A2B');F(A,shaftX+5,carY+2,shaftW-10,1,'#C9A24B');glow(A,shaftX+Math.round(shaftW/2),carY+5,'#F8E2B4');
  // passengers inside (FILL): standard mixed sims; service = housekeepers
  const cap = glass?5:3; const inCar = glass?5:3;
  const pcol = kind==='service'?['#3E8E8E','#3E8E8E']:['#5A6E8C','#6E5A4A','#D8B05A','#3F8C84','#8A94A8'];
  for(let i=0;i<inCar;i++)pw(A,shaftX+7+i*Math.round((shaftW-16)/inCar),carY+carH-2,pcol[i%pcol.length]);
  // doors (open frame) + direction lantern (up)
  F(A,shaftX+3,carY,1,carH,'#8A8E82');F(A,shaftX+shaftW-4,carY,1,carH,'#8A8E82');
  F(A,shaftX+Math.round(shaftW/2)-1,carFb-2,3,3,'#6bd47a');glow(A,shaftX+Math.round(shaftW/2),carFb-1,'#6bd47a');
  // QUEUES at landings: same tracked sims; the car's floor queue is short (they boarded)
  for(let f=0;f<3;f++){const num=3-f;const deckY=f*fH+fH-6;if(glass&&!(num===1||num===3))continue;
    let n; if(f===carFloor) n=(kind==='service'?0:1); else n=(kind==='service'?2:(num===1?5:3));
    // queue on the LEFT corridor, lined up toward the shaft (dir -1 from just left of shaft)
    if(n>0)queue(A,shaftX-9,-1,deckY,n);
  }
}
let cx=40,cy=root.height+16,rowH=0;
const H1=figma.createText();H1.fontName={family:'Inter',style:'Bold'};H1.fontSize=18;H1.characters="Elevators  (shaft across floors, car FILL, and per-floor waiting queues of tracked sims)";H1.fills=[{type:'SOLID',color:hex('#F3D08A')}];root.appendChild(H1);H1.x=40;H1.y=cy;cy+=30;
function place(label,cap,tiles,floors,fn){const PS=3,W=tiles*11*PS,H=floors*44*PS;if(cx+W>1240){cx=40;cy+=rowH+80;rowH=0;}render("art:"+label,cx,cy,tiles,floors,fn);annotate(label,cap,cx,cy+H+8,W);cx+=W+30;rowH=Math.max(rowH,H);}
place("Standard Elevator","Shown in context across 3 floors: dark shaft with rails, floor numbers and a motor. The warm-lit car (here on floor 2) shows its passenger FILL; the queues on floors 3 and 1 are the same tracked sims waiting, tinting amber then stress red the longer they wait. When a car arrives they board up to capacity and the rest stay in the same line.",16,3,(A,W,H)=>elevator(A,W,H,'standard'));
place("Service Elevator","Staff-only (housekeepers ride it to hotel floors): plainer gray car and shorter, staff-only queues in the same tracked model. Same shaft footprint as the standard car.",16,3,(A,W,H)=>elevator(A,W,H,'service'));
root.resize(1280, cy+rowH+110);
return { built:["standard elevator","service elevator"], frameId:root.id };
