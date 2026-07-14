
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const root=await figma.getNodeByIdAsync("1:2");
await figma.setCurrentPageAsync(root.parent);
await figma.loadFontAsync({family:"Inter",style:"Regular"});
const old=root.children.find(c=>c.name==="art:ParkingRamp");const gx=old.x,gy=old.y;old.remove();
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
function render(name,gx,gy,tiles,fn){const PS=3,W=tiles*11,H=44,A=[];fn(A,W,H);const sc=figma.createFrame();sc.name=name;sc.resize(W*PS,H*PS);sc.clipsContent=true;sc.cornerRadius=3;sc.fills=[{type:'SOLID',color:hex('#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.4},offset:{x:0,y:2},radius:6,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});}
function ramp(A,W,H){
  const farEdge=x=>14+Math.round((x-24)*18/94), nearEdge=x=>farEdge(x)+8;
  F(A,0,0,W,H,'#313640');
  // ceiling beam + joists + pipe + conduit
  F(A,0,0,W,4,'#4A4E56');F(A,0,0,W,1,'#5C606A');F(A,0,4,W,1,'#2E3238');
  for(const jx of [16,32,48,64,80,96,112,128,144,160])F(A,jx,5,1,2,'#34383E');
  F(A,16,6,144,1,'#6C7684');F(A,16,8,144,1,'#4A525C');
  for(const sx of [40,72,104,136])F(A,sx,4,1,2,'#34383E');
  F(A,92,10,68,1,'#5B6470');
  // under-ramp void (mass) + support column
  for(let x=24;x<=118;x++){const ne=nearEdge(x);F(A,x,ne,1,40-ne,'#2A2E34');}
  F(A,67,31,5,9,'#3A3E46');
  // road surface with light/dark edge rails
  for(let x=24;x<=118;x++){const fe=farEdge(x),ne=nearEdge(x);F(A,x,fe,1,ne-fe,'#565A62');F(A,x,fe,1,1,'#6E727A');F(A,x,ne-1,1,1,'#3E434B');}
  for(let x=28;x<=116;x++){F(A,x,farEdge(x)+3,1,1,'#4C5058');F(A,x,farEdge(x)+5,1,1,'#4C5058');}
  // descending chevrons = direction arrow
  for(const p of [[40,21],[62,25],[84,29],[106,34]]){F(A,p[0]-3,p[1]-3,5,2,'#D9BE55');F(A,p[0]-3,p[1]+1,5,2,'#D9BE55');F(A,p[0]+1,p[1]-1,2,2,'#D9BE55');}
  // ramp mouth portal (cars descend from above)
  F(A,14,12,10,12,'#24282E');F(A,19,12,8,2,'#D9BE55');F(A,21,12,1,2,'#2E3238');F(A,24,12,1,2,'#2E3238');
  // flat deck at foot
  F(A,118,32,58,8,'#565A62');F(A,118,32,58,1,'#6E727A');F(A,118,39,58,1,'#3E434B');
  // P roundel
  F(A,143,4,1,5,'#34383E');F(A,149,4,1,5,'#34383E');F(A,140,9,12,11,'#2F5DA8');F(A,140,9,12,1,'#1E3E76');F(A,143,11,2,7,'#EDEFF2');F(A,143,11,5,1,'#EDEFF2');F(A,147,12,1,2,'#EDEFF2');F(A,143,14,5,1,'#EDEFF2');
  // pillars with hazard bands
  for(const px of [6,160]){F(A,px,8,6,32,'#4A4E56');F(A,px,8,1,32,'#5C606A');F(A,px+5,8,1,32,'#34383E');F(A,px-1,38,8,2,'#4A4E56');F(A,px,27,6,4,'#D9BE55');F(A,px+1,27,1,4,'#2E3238');F(A,px+3,27,1,4,'#2E3238');}
  // foundation + oil + lane arrow + stall divider + second-car nose
  F(A,0,41,W,2,'#3E424A');F(A,88,41,1,2,'#2E3238');
  F(A,140,38,12,2,'#2C3036');
  F(A,122,36,6,1,'#9AA0A8');F(A,120,35,2,3,'#9AA0A8');
  F(A,158,33,1,7,'#9AA0A8');
  F(A,168,32,8,5,'#6E6A62');F(A,170,35,4,4,'#16181C');F(A,171,35,2,1,'#6A6E76');
  // primary parked car (side view, wheels on deck)
  F(A,135,40,20,1,'#2C3036');
  F(A,137,35,5,4,'#16181C');F(A,149,35,5,4,'#16181C');F(A,138,35,3,1,'#6A6E76');F(A,150,35,3,1,'#6A6E76');
  F(A,134,32,22,5,'#5D7FA6');F(A,134,32,22,1,'#7E9EC0');F(A,134,37,22,1,'#3E5876');
  F(A,139,27,12,5,'#5D7FA6');F(A,139,27,12,1,'#7E9EC0');F(A,140,28,10,3,'#AEBFD4');F(A,145,28,1,3,'#5D7FA6');
  F(A,134,35,1,1,'#E7D9A6');F(A,156,35,1,1,'#C98A3A');
}
render("art:ParkingRamp", gx, gy, 16, ramp);
const cap=root.findOne(n=>n.type==="TEXT"&&n.characters.startsWith("The basement car ramp"));
if(cap)cap.characters="The basement car ramp (design-party redraw): a solid shaded ramp slab with a dark void beneath and a support column so it reads as a raised driving surface, descending yellow chevrons, a ramp-mouth portal, garage beams, pipes and pillars, the blue P roundel, and a side-view car parked at the ramp foot with wheels on the deck.";
return { fixed:"parking-ramp", at:[gx,gy] };
