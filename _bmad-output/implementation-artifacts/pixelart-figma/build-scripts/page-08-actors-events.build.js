
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
await figma.loadFontAsync({family:"Inter",style:"Bold"});await figma.loadFontAsync({family:"Inter",style:"Semi Bold"});await figma.loadFontAsync({family:"Inter",style:"Regular"});
const page=figma.createPage(); page.name="08 · Actors, Vehicles & Events"; await figma.setCurrentPageAsync(page);
const root=figma.createFrame(); root.name="board"; root.resize(1180,560); root.fills=[{type:'SOLID',color:hex('#161C28')}]; page.appendChild(root);
function shd(h,a){const n=parseInt(h.slice(1),16);const c=v=>Math.max(0,Math.min(255,v+a));const r=c((n>>16)&255),g=c((n>>8)&255),b=c(n&255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
function glow(A,cx,cy,c){[[4,0.1],[3,0.16],[2,0.3],[1,0.6]].forEach(s=>F(A,cx-s[0],cy-s[0],s[0]*2,s[0]*2,c,s[1]));}
function stage(name,gx,gy,natW,natH,bg,fn){const PS=6,A=[];fn(A,natW,natH);const sc=figma.createFrame();sc.name=name;sc.resize(natW*PS,natH*PS);sc.clipsContent=true;sc.cornerRadius=4;sc.fills=[{type:'SOLID',color:hex(bg||'#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.4},offset:{x:0,y:2},radius:6,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});return natW*PS;}
function annotate(name,cap,x,y,w){const t=figma.createText();t.fontName={family:'Inter',style:'Semi Bold'};t.fontSize=13;t.characters=name;t.fills=[{type:'SOLID',color:hex('#F4F0E4')}];root.appendChild(t);t.x=x;t.y=y;const c=figma.createText();c.fontName={family:'Inter',style:'Regular'};c.fontSize=11;c.characters=cap;c.fills=[{type:'SOLID',color:hex('#9AA4B4')}];c.textAutoResize='HEIGHT';root.appendChild(c);c.resize(Math.max(w||220,180),56);c.x=x;c.y=y+16;}
const T=figma.createText();T.fontName={family:'Inter',style:'Bold'};T.fontSize=24;T.characters="Actors, Vehicles & Events";T.fills=[{type:'SOLID',color:hex('#F4F0E4')}];root.appendChild(T);T.x=40;T.y=28;
const S=figma.createText();S.fontName={family:'Inter',style:'Regular'};S.fontSize=13;S.characters="Moving actors (own sprites the engine slides along a floor) and event characters. Shown at 6x.";S.fills=[{type:'SOLID',color:hex('#AEB8C6')}];root.appendChild(S);S.x=40;S.y=60;

// GARBAGE TRUCK (collects recycling each morning)
function truck(A,W,H){const g=H-3;F(A,0,g,W,3,'#3A3E44');F(A,0,g,W,1,'#4E545C'); // road
  const bodyW=W-13;
  F(A,0,4,bodyW,g-4,'#4A7A44');F(A,0,4,bodyW,1,'#6A9A5E'); // hopper + top light
  for(let rx=3;rx<bodyW-2;rx+=5)F(A,rx,5,1,g-6,'#3A6236'); // ribs
  F(A,0,7,bodyW,1,'#2E5A2A'); // seam
  // recycle arrows badge
  F(A,4,9,7,1,'#DCE8C0');F(A,10,8,1,3,'#DCE8C0');F(A,4,11,7,1,'#DCE8C0');F(A,4,10,1,2,'#DCE8C0');
  F(A,bodyW,6,11,g-6,'#5A8A54');F(A,bodyW,6,11,1,'#6A9A5E'); // cab
  F(A,bodyW+4,8,6,4,'#CFE4FF');F(A,bodyW+4,8,6,1,'#E4F0FF'); // window
  F(A,0,6,3,g-6,'#3A5A36'); // loader mouth (back)
  // wheels
  for(const wx of [5,bodyW-7,bodyW+5]){F(A,wx,g-3,5,5,'#16181C');F(A,wx+1,g-2,3,3,'#5A5E66');}
  // a couple garbage bags at the loader
  F(A,-0,g-5,4,5,'#2F3628');F(A,2,g-7,3,3,'#3A4232');F(A,1,g-6,1,1,'#FFFFFF',0.3);
}
// THIEF (crime event)
function thief(A,W,H){const g=H-2;F(A,0,g,W,2,'#000000',0.25);
  const cx=6;
  F(A,cx-1,g-3,2,3,'#1A1D22');F(A,cx+3,g-4,2,4,'#1A1D22'); // tiptoe legs
  F(A,cx,g-11,6,8,'#232830');F(A,cx,g-11,1,8,'#14171C');F(A,cx+5,g-11,1,8,'#33383F'); // dark body
  for(let sy=g-10;sy<g-4;sy+=2)F(A,cx,sy,6,1,'#3A4048'); // faint stripes (burglar)
  F(A,cx+1,g-15,4,4,'#E8C9A0'); // face
  F(A,cx+1,g-14,4,1,'#14171C'); // mask band over eyes
  F(A,cx,g-17,6,2,'#1A1D22');F(A,cx,g-16,6,1,'#33383F'); // cap
  // swag sack over shoulder
  F(A,cx+6,g-12,5,6,'#C9B98A');F(A,cx+6,g-12,5,1,'#E0D2A8');F(A,cx+7,g-13,3,1,'#8A7A54'); // tie
  F(A,cx+8,g-10,2,2,'#8A7A54');F(A,cx+8,g-10,1,1,'#E8C14A'); // a coin poking out
  // sneaky motion dashes
  F(A,cx-4,g-8,2,1,'#5A6472',0.5);F(A,cx-7,g-6,2,1,'#5A6472',0.35);
}
// SANTA (December event)
function santa(A,W,H){const g=H-2;F(A,0,g,W,2,'#000000',0.25);
  const cx=6;
  F(A,cx,g-3,2,3,'#141414');F(A,cx+4,g-3,2,3,'#141414'); // boots
  F(A,cx,g-11,6,8,'#B8342E');F(A,cx,g-11,1,8,'#8A241E');F(A,cx+5,g-11,1,8,'#D0483E'); // red coat
  F(A,cx,g-6,6,2,'#F4F0EC');F(A,cx,g-6,6,1,'#FFFFFF'); // fur hem
  F(A,cx,g-9,6,1,'#2A2A2A');F(A,cx+2,g-9,2,1,'#E8C14A'); // belt + buckle
  F(A,cx+1,g-15,4,4,'#E8C9A0'); // face
  F(A,cx,g-13,6,3,'#F4F0EC');F(A,cx+2,g-12,2,1,'#E8B090'); // beard + rosy
  F(A,cx,g-18,6,2,'#B8342E');F(A,cx+4,g-19,3,2,'#B8342E'); // hat
  F(A,cx,g-16,6,1,'#FFFFFF');F(A,cx+6,g-19,2,2,'#FFFFFF'); // hat brim + pom
  // toy sack over shoulder
  F(A,cx+6,g-13,6,8,'#8A5A3A');F(A,cx+6,g-13,6,1,'#A06E48');F(A,cx+8,g-15,3,2,'#E0452C');F(A,cx+9,g-16,1,2,'#5AA85A'); // sack + gift poking
}
// METRO TRAIN CAR
function train(A,W,H){F(A,0,0,W,H,'#C6CCD4');F(A,0,0,W,2,'#E0E6EC');F(A,0,H-4,W,3,'#D0392B');F(A,0,H-4,W,1,'#E85D4A');for(let wx=4;wx+5<W;wx+=9){F(A,wx,2,6,4,'#2A3440');F(A,wx+1,3,4,2,'#9FC0E0',0.7);}F(A,1,3,2,2,'#FFE27A');}
// STREET CAR
function car(A,W,H){F(A,1,3,W-2,4,'#4E7A9E');F(A,4,0,W-8,4,'#3E6486');F(A,5,1,3,2,'#CFE4FF');F(A,9,1,3,2,'#CFE4FF');F(A,2,6,3,2,'#16181C');F(A,W-6,6,3,2,'#16181C');F(A,W-2,3,1,1,'#FFE27A');}
let x=40,y=100,rowH=0;
function place(nm,cap,natW,natH,bg,fn){const w=natW*6;if(x+w>1140){x=40;y+=rowH+64;rowH=0;}stage("actor:"+nm,x,y,natW,natH,bg,fn);annotate(nm,cap,x,y+natH*6+8,Math.max(w,200));x+=Math.max(w,200)+30;rowH=Math.max(rowH,natH*6);}
place("Garbage Truck","Municipal recycling truck: ribbed green hopper with a recycle badge, cab and window, rear loader mouth, and bags. Slides to each recycling center at the morning collection hour.",34,17,"#20303A",truck);
place("Metro Train","Silver carriage with red livery, a lit window band and headlight. Slides in and out along the platform.",44,10,"#171C24",train);
place("Street Car","Commuter sedan for the parking runs, driven along the garage at commute hours.",16,9,"#171C24",car);
place("Thief","Crime event: a masked burglar in dark stripes tiptoeing off with a swag sack. Security reduces these.",16,20,"#14110E",thief);
place("Santa","December event: red suit and fur trim, white beard, hat with pom, and a toy sack. A seasonal visitor.",16,22,"#101826",santa);
root.resize(1180, y+rowH+96);
return { built:"actors page", pageId: page.id };
