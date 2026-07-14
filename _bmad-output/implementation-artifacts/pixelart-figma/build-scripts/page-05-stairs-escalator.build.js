
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const root=await figma.getNodeByIdAsync("62:3");
await figma.setCurrentPageAsync(root.parent);
await figma.loadFontAsync({family:"Inter",style:"Regular"});
function shd(h,a){const n=parseInt(h.slice(1),16);const c=v=>Math.max(0,Math.min(255,v+a));const r=c((n>>16)&255),g=c((n>>8)&255),b=c(n&255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
// bigger person ~18px for transport riders (scaled up from before)
function person(A,x,f,sh){const head=4,body=9,leg=4;F(A,x-1,f,7,1,'#000000',0.25);F(A,x+1,f-leg,2,leg,'#2A2E38');F(A,x+3,f-leg,2,leg,'#2A2E38');F(A,x,f-leg-body,6,body,sh);F(A,x,f-leg-body,1,body,shd(sh,-26));F(A,x+5,f-leg-body,1,body,shd(sh,16));F(A,x+1,f-leg-body+2,4,1,shd(sh,-14));F(A,x+1,f-leg-body-head,4,head,'#E8C9A0');F(A,x+1,f-leg-body-head,4,1,'#3A2E28');F(A,x+3,f-leg-body-head+1,1,1,'#F0D8B8');}
function render(name,gx,gy,tiles,floors,fn){const PS=3,W=tiles*11,H=floors*44,A=[];fn(A,W,H);const sc=figma.createFrame();sc.name=name;sc.resize(W*PS,H*PS);sc.clipsContent=true;sc.cornerRadius=3;sc.fills=[{type:'SOLID',color:hex('#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.45},offset:{x:0,y:2},radius:7,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});}
function bgOffice(A,W,H){for(const fb of [0,H/2]){const fy=fb+H/2-6;F(A,0,fb,W,H/2,'#E4D8BC');F(A,0,fb,W,1,'#D0C4A6');F(A,0,fy,W,6,'#6E7A48');for(let dx=6;dx<W-6;dx+=22){F(A,dx,fy-6,16,3,'#8C6E50');F(A,dx+3,fy-12,6,6,'#20242C');}}F(A,0,0,W,H,'#0C1019',0.34);F(A,0,H/2-1,W,1,'#3A3E30');}
function bgShop(A,W,H){for(const fb of [0,H/2]){const fy=fb+H/2-6;F(A,0,fb,W,H/2,'#EAE0EE');F(A,0,fb,W,4,'#b58ad6');F(A,0,fy,W,6,'#C8BCD2');for(let dx=8;dx<W-6;dx+=9)F(A,dx,fy-9,5,5,['#e85d5d','#5db4e8','#6bd47a','#e8c14a'][dx%4]);}F(A,0,0,W,H,'#0C1019',0.34);F(A,0,H/2-1,W,1,'#3A3644');}
function stairs(A,W,H){bgOffice(A,W,H);
  const x0=8,x1=W-20,yBot=H-7,yTopE=H/2-6,n=6; // rise ONE floor, land on floor 2 deck (y=H/2-6)
  const step=(x1-x0)/n, rise=(yBot-yTopE)/n;
  const line=x=>yBot-((x-x0)/(x1-x0))*(yBot-yTopE);
  for(let x=x0;x<x1;x++)F(A,x+2,Math.round(line(x))+3,1,11,'#000000',0.30);
  for(let x=x0;x<=x1;x++){const si=Math.min(n-1,Math.floor((x-x0)/step));const ty=Math.round(yBot-si*rise);const under=Math.round(line(x)+13);F(A,x,ty-2,1,Math.max(1,under-(ty-2)),'#9A8666');}
  for(let x=x0;x<=x1;x++)F(A,x,Math.round(line(x)+13),1,2,'#2A2018');
  for(let i=0;i<n;i++){const sx=Math.round(x0+i*step);const ty=Math.round(yBot-i*rise);const sw=Math.ceil(step)+1;F(A,sx,ty-3,sw,3,'#EDE6D2');F(A,sx,ty-3,sw,1,'#F8F2E0');const nx=Math.round(x0+(i+1)*step);F(A,nx,Math.round(yBot-(i+1)*rise)-3,1,Math.round(rise)+3,'#241E14');}
  // handrail
  for(let x=x0;x<x1;x++)F(A,x,Math.round(line(x))-12,1,2,'#6B4A2B');
  for(let i=1;i<n;i+=2){const sx=Math.round(x0+i*step);F(A,sx,Math.round(yBot-i*rise)-12,1,10,'#5A3E28');}
  // TOP LANDING on floor 2 (does not continue up)
  F(A,x1-2,yTopE-3,22,3,'#9A8666');F(A,x1-2,yTopE-3,22,1,'#B49E7A');F(A,x1-2,yTopE,22,1,'#2A2018');
  // bottom landing on floor 1
  F(A,2,yBot-2,12,4,'#9A8666');F(A,2,yBot-2,12,1,'#B49E7A');
  const ci=3,cx=Math.round(x0+ci*step+2);person(A,cx,Math.round(yBot-ci*rise)-3,'#5A6E8C');
  F(A,3,H/2+3,11,4,'#0E3A1E');for(let k=0;k<4;k++)F(A,4+k*2,H/2+4,1,2,'#6bd47a');
  F(A,W-14,3,11,4,'#0E3A1E');for(let k=0;k<4;k++)F(A,W-13+k*2,4,1,2,'#6bd47a');
}
function escalator(A,W,H){bgShop(A,W,H);
  const x0=8,x1=W-20,yBot=H-7,yTopE=H/2-6;
  const line=x=>yBot-((x-x0)/(x1-x0))*(yBot-yTopE);
  for(let x=x0;x<x1;x++)F(A,x+2,Math.round(line(x))+4,1,10,'#000000',0.30);
  for(let x=x0;x<=x1;x++){const t=Math.round(line(x));F(A,x,t-1,1,1,'#141118');F(A,x,t,1,9,'#6E747C');F(A,x,t,1,1,'#9AA0A8');F(A,x,t+8,1,2,'#3A3E46');}
  for(let x=x0;x<x1;x+=4){const t=Math.round(line(x));F(A,x,t+1,1,7,'#3A3E46');F(A,x-1,t+1,1,7,'#F0C24A');}
  for(let x=x0;x<x1;x++){const t=Math.round(line(x));F(A,x,t-12,1,11,'#BFD0E0',0.20);}
  for(let x=x0;x<x1;x++){const t=Math.round(line(x));F(A,x,t-13,1,2,'#1A1D24');F(A,x,t-13,1,1,'#3A3E46');}
  // TOP LANDING on floor 2
  F(A,x1-2,yTopE-2,22,5,'#6A6E76');F(A,x1-2,yTopE-2,22,1,'#8A8E96');F(A,x1-2,yTopE+3,22,1,'#3A3E46');
  F(A,2,yBot-2,14,5,'#6A6E76');F(A,2,yBot-2,14,1,'#8A8E96');
  for(let t2=0.25;t2<0.85;t2+=0.3){const x=Math.round(x0+(x1-x0)*t2);person(A,x,Math.round(line(x)),['#5A6E8C','#B0857A','#3F8C84'][Math.round(t2*3)%3]);}
}
for(const nm of ["art:Stairway","art:Escalator"]){const f=root.children.find(c=>c.name&&c.name.startsWith(nm));if(f){const gx=f.x,gy=f.y;f.remove();render(nm+"  ·  2 floors",gx,gy,8,2,nm==="art:Stairway"?stairs:escalator);}}
const cs=root.findOne(n=>n.type==="TEXT"&&n.characters.startsWith("Two floors, ONE flight"));if(cs)cs.characters="Two floors, ONE flight that rises exactly one floor and terminates in a LANDING on the second-floor deck (it does not run into floor 2). Shown over a faint office: bright treads with dark risers on a shaded stringer, a handrail, top and bottom landings, a climber, outline + drop shadow, EXIT signs on both floors.";
const ce=root.findOne(n=>n.type==="TEXT"&&n.characters.startsWith("Two floors, one diagonal"));if(ce)ce.characters="Two floors, one diagonal run rising a single floor to a LANDING on the second-floor deck. Over a faint shop: metal steps with amber edges, a glass balustrade and handrail, top and bottom landings, riders, outline + drop shadow.";
return { fixed:"transport lands on floor 2" };
