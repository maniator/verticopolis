
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const root=await figma.getNodeByIdAsync("1:2");
await figma.loadFontAsync({family:"Inter",style:"Semi Bold"});
await figma.loadFontAsync({family:"Inter",style:"Regular"});
function shd(h,a){const n=parseInt(h.slice(1),16);const c=v=>Math.max(0,Math.min(255,v+a));const r=c((n>>16)&255),g=c((n>>8)&255),b=c(n&255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
function box(A,x,y,w,h,b){F(A,x,y+h,w,1,'#000000',0.18);F(A,x,y,w,h,b);F(A,x,y,w,1,shd(b,22));F(A,x,y,1,h,shd(b,12));F(A,x+w-1,y,1,h,shd(b,-16));F(A,x,y+h-1,w,1,shd(b,-22));}
function glow(A,cx,cy,c){[[4,0.1],[3,0.16],[2,0.3],[1,0.6]].forEach(s=>F(A,cx-s[0],cy-s[0],s[0]*2,s[0]*2,c,s[1]));}
function person(A,x,f,sh,coat){F(A,x-1,f,5,1,'#000000',0.18);F(A,x,f-1,1,1,'#242A34');F(A,x+2,f-1,1,1,'#242A34');F(A,x,f-6,3,5,sh);if(coat){F(A,x,f-4,3,3,'#F4F0EC');F(A,x,f-4,1,3,'#D8D4CC');}F(A,x,f-6,1,5,shd(sh,-24));F(A,x,f-8,2,2,'#E8C9A0');F(A,x,f-8,2,1,'#3A2E28');F(A,x+1,f-7,1,1,'#F0D8B8');}
function wallp(A,x,y,w,h,b,seam){F(A,x,y,w,h,b);F(A,x,y,w,1,shd(b,14));F(A,x,y+h-2,w,2,shd(b,-12));if(seam){for(let px=x+8;px<x+w;px+=12)F(A,px,y+2,1,h-4,shd(b,-10));for(let py=y+8;py<y+h-4;py+=8)F(A,x,py,w,1,shd(b,-8));}}
function floorb(A,x,fy,w,h,b){F(A,x,fy,w,h,b);F(A,x,fy,w,1,shd(b,18));F(A,x,fy+1,w,1,shd(b,-8));F(A,x,fy+h-1,w,1,shd(b,-24));}
function render(name,gx,gy,tiles,floors,fn){const PS=3,W=tiles*11,H=floors*44,A=[];fn(A,W,H);const sc=figma.createFrame();sc.name=name;sc.resize(W*PS,H*PS);sc.clipsContent=true;sc.cornerRadius=3;sc.fills=[{type:'SOLID',color:hex('#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.4},offset:{x:0,y:2},radius:6,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});}
function annotate(name,cap,x,y,w){const t=figma.createText();t.fontName={family:'Inter',style:'Semi Bold'};t.fontSize=14;t.characters=name;t.fills=[{type:'SOLID',color:hex('#F4F0E4')}];root.appendChild(t);t.x=x;t.y=y;const c=figma.createText();c.fontName={family:'Inter',style:'Regular'};c.fontSize=11;c.characters=cap;c.fills=[{type:'SOLID',color:hex('#9AA4B4')}];c.textAutoResize='HEIGHT';root.appendChild(c);c.resize(Math.max(w||280,220),40);c.x=x;c.y=y+18;}

function medical(A,W,H){const fy=H-6;
  wallp(A,0,0,W,fy,'#EDE9E2',true); floorb(A,0,fy,W,6,'#CFD6D2');
  for(let lx=24;lx<W;lx+=44){F(A,lx,2,10,2,'#F8E2B4');glow(A,lx+5,5,'#F8E2B4');}
  // red cross sign
  F(A,6,8,14,14,'#F4F0EC');F(A,10,10,6,10,'#D6342F');F(A,7,13,12,4,'#D6342F');
  // exam bed with patient + curtain rail
  box(A,28,fy-9,26,9,'#DCE2E8');F(A,28,fy-9,26,1,'#F0F4F8');F(A,30,fy-12,6,3,'#E8C9A0');F(A,30,fy-13,6,1,'#3A2E28'); // pillow+head
  F(A,36,fy-10,16,3,'#BFD0DE'); // blanket
  F(A,26,10,1,fy-16,'#B8BCC0');F(A,26,10,28,1,'#B8BCC0'); // curtain rail
  F(A,54,12,4,fy-18,'#9FC0C8',0.6); // half curtain
  // heart monitor
  box(A,64,fy-16,14,10,'#20242C');F(A,66,fy-14,10,6,'#0E241A');F(A,66,fy-11,2,1,'#6bd47a');F(A,68,fy-12,1,3,'#6bd47a');F(A,69,fy-10,2,1,'#6bd47a');F(A,71,fy-13,1,5,'#6bd47a');F(A,72,fy-11,4,1,'#6bd47a');glow(A,71,fy-11,'#3ADf6A'.slice(0,7));
  // IV stand
  F(A,60,fy-16,1,16,'#B8BCC0');F(A,58,fy-18,5,3,'#CFE0FF',0.8);
  // nurse + doctor
  person(A,84,fy,'#8FB6D8',true);person(A,92,fy,'#6E7A88',true);
  // supply cabinet with bottles
  box(A,104,fy-16,22,16,'#F4F4F0');for(let r=0;r<2;r++)for(let k=0;k<5;k++){F(A,107+k*4,fy-14+r*7,3,4,['#9FD0C8','#E8C9A0','#5db4e8','#F4A0A0','#DcE8C0'][k]);}
  F(A,104,fy-16,22,1,'#D8D8D0');
  // wheelchair
  F(A,132,fy-8,6,5,'#3A4250');F(A,132,fy-11,5,4,'#4A5464');F(A,132,fy-2,3,3,'#1A1D24');F(A,137,fy-3,2,2,'#1A1D24');
  // second bed
  box(A,144,fy-9,26,9,'#DCE2E8');F(A,146,fy-12,6,3,'#C99A6E');F(A,146,fy-13,6,1,'#3A2E28');F(A,152,fy-10,16,3,'#BFD0DE');
}
render("art:Medical", 40, 1160, 16, 1, medical);
annotate("Medical Center  ·  16 tiles x 1 floor", "Bright clinic: tiled walls, ceiling lights, a red-cross sign, two curtained exam beds with resting patients, a beeping heart monitor with a green trace, an IV stand, a wheelchair, a stocked supply cabinet, and a nurse and doctor in white coats.", 40, 1160+132+8, 520);

function security(A,W,H){const fy=H-6;
  wallp(A,0,0,W,fy,'#2C3A5A',false); floorb(A,0,fy,W,6,'#242A38');
  // monitor wall (grid of camera screens)
  for(let r=0;r<2;r++)for(let cN=0;cN<5;cN++){const mx=6+cN*10,my=6+r*11;box(A,mx,my,8,9,'#0E1420');F(A,mx+1,my+1,6,5,'#1A3A2A');F(A,mx+1+((r+cN)%3),my+2,1,3,'#6bd47a',0.8);F(A,mx+1,my+1,6,1,'#2A4A3A');}
  // guard desk + seated guard
  box(A,58,fy-8,26,8,'#2A3550');F(A,58,fy-8,26,1,'#3E4A66');person(A,64,fy,'#3E4A66',false);
  // badge shield
  F(A,60,fy-14,6,6,'#D8B05A');F(A,62,fy-13,2,4,'#8A6A2A');
  // key rack
  F(A,78,8,8,5,'#5A4A36');for(let k=0;k<4;k++)F(A,79+k*2,13,1,2,'#D8B05A');
  // red alarm light
  F(A,W-8,7,4,4,'#E85D5D');glow(A,W-6,9,'#FF6B6B');
}
render("art:Security", 592, 1160, 8, 1, security);
annotate("Security  ·  8 tiles x 1 floor", "Control room: a wall of green-tinted camera monitors, a seated guard at a console desk, a brass badge shield, a key rack, and a red alarm light.", 592, 1160+132+8, 264);

function parking(A,W,H){const fy=H-6;
  F(A,0,0,W,fy,'#565A62');F(A,0,0,W,3,'#3E424A');F(A,0,4,W,1,'#5E636B'); // ceiling beam + pipe
  floorb(A,0,fy,W,6,'#4A4E56');
  F(A,4,2,3,fy-2,'#3E424A');F(A,4,2,1,fy-2,'#4E535B'); // pillar
  // bay lines
  F(A,10,fy-16,1,15,'#DCDCD0',0.5);F(A,W-4,fy-16,1,15,'#DCDCD0',0.5);
  // car
  box(A,14,fy-9,26,7,'#4E7A9E');F(A,17,fy-13,20,5,'#3E6486');F(A,19,fy-12,7,3,'#CFE4FF');F(A,28,fy-12,7,3,'#CFE4FF');F(A,15,fy-3,4,3,'#1A1D24');F(A,34,fy-3,4,3,'#1A1D24');F(A,38,fy-8,2,2,'#FFE27A'); // headlight
  // oil stain
  F(A,16,fy+2,20,1,'#000000',0.25);
  // P sign
  F(A,W-12,8,9,9,'#2A5AA8');F(A,W-10,10,2,5,'#FFFFFF');F(A,W-10,10,4,1,'#FFFFFF');F(A,W-7,11,1,2,'#FFFFFF');F(A,W-10,12,3,1,'#FFFFFF');
}
render("art:Parking", 880, 1160, 4, 1, parking);
annotate("Parking Space  ·  4 tiles x 1 floor", "Basement garage bay: concrete deck, ceiling beam and pipe, a support pillar, painted stall lines, an oil stain, the blue P sign, and one parked car with lit headlights.", 880, 1160+132+8, 200);
root.resize(1280, 1400);
return { done:["medical","security","parking"] };
