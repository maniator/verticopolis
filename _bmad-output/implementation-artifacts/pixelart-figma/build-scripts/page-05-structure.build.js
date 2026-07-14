
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const root=await figma.getNodeByIdAsync("62:3");
await figma.setCurrentPageAsync(root.parent);
await figma.loadFontAsync({family:"Inter",style:"Regular"});
function shd(h,a){const n=parseInt(h.slice(1),16);const c=v=>Math.max(0,Math.min(255,v+a));const r=c((n>>16)&255),g=c((n>>8)&255),b=c(n&255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
function box(A,x,y,w,h,b){F(A,x,y+h,w,1,'#000000',0.2);F(A,x,y,w,h,b);F(A,x,y,w,1,shd(b,22));F(A,x,y,1,h,shd(b,12));F(A,x+w-1,y,1,h,shd(b,-16));F(A,x,y+h-1,w,1,shd(b,-22));}
function glow(A,cx,cy,c){[[4,0.1],[3,0.16],[2,0.3],[1,0.6]].forEach(s=>F(A,cx-s[0],cy-s[0],s[0]*2,s[0]*2,c,s[1]));}
function pWalk(A,x,f,sh){const head=5,body=13,leg=6;F(A,x-1,f,8,1,'#000000',0.26);F(A,x+1,f-leg,2,leg,'#2A2E38');F(A,x+4,f-leg,2,leg,'#2A2E38');F(A,x,f-leg-body,7,body,sh);F(A,x,f-leg-body,1,body,shd(sh,-26));F(A,x+6,f-leg-body,1,body,shd(sh,16));F(A,x+1,f-leg-body+3,5,1,shd(sh,-14));F(A,x+1,f-leg-body-head,5,head,'#E8C9A0');F(A,x+1,f-leg-body-head,5,1,'#3A2E28');F(A,x+4,f-leg-body-head+2,1,1,'#F0D8B8');}
function pDesk(A,x,f,sh){const head=5,body=10;F(A,x-1,f,7,1,'#000000',0.24);F(A,x,f-body,6,body,sh);F(A,x,f-body,1,body,shd(sh,-26));F(A,x+5,f-body,1,body,shd(sh,16));F(A,x+1,f-body+2,4,1,shd(sh,-14));F(A,x+1,f-body-head,4,head,'#E8C9A0');F(A,x+1,f-body-head,4,1,'#3A2E28');F(A,x+3,f-body-head+2,1,1,'#F0D8B8');}
function pfloor(A,x,fy,w,h,b){F(A,x,fy,w,h,b);F(A,x,fy,w,1,shd(b,18));F(A,x,fy+1,w,1,shd(b,-8));F(A,x,fy+h-1,w,1,shd(b,-24));}
function skyline(A,x,y,w,h){for(let bx=x,s=0;bx<x+w;s++){const bw=3+((s*5)%5),bh=4+((s*11)%(h-2));F(A,bx,y+h-bh,Math.min(bw,x+w-bx),bh,shd('#5A7A9E',-((s%3)*8)));for(let wy=y+h-bh+1;wy<y+h-1;wy+=2)F(A,bx+1,wy,1,1,'#F3D08A',0.6);bx+=bw+1;}}
function bloom(A,x,y,c){F(A,x,y,3,3,c);F(A,x,y,3,1,shd(c,24));F(A,x+1,y+1,1,1,'#FFFFFF',0.4);}
function render(name,gx,gy,tiles,fn){const PS=3,W=tiles*11,H=44,A=[];fn(A,W,H);const sc=figma.createFrame();sc.name=name;sc.resize(W*PS,H*PS);sc.clipsContent=true;sc.cornerRadius=3;sc.fills=[{type:'SOLID',color:hex('#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.45},offset:{x:0,y:2},radius:7,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});}
function floorTile(A,W,H){const fy=34;
  F(A,0,0,W,H,'#B7B0A0');F(A,0,0,W,5,'#8A8478');
  F(A,0,5,W,1,'#6E6A60');for(let px=0;px<W;px+=8)F(A,px,1,2,3,'#7A7468');
  pfloor(A,0,fy,W,H-fy,'#9A9486');
  F(A,0,fy-2,W,2,'#8A8478');for(let px=4;px<W;px+=12)F(A,px,fy-4,2,4,'#7E786C');
  F(A,Math.round(W*0.3),5,1,4,'#3A3E44');F(A,Math.round(W*0.3)-2,9,5,2,'#3A3E44');F(A,Math.round(W*0.3)-1,10,3,1,'#F8E2B4');glow(A,Math.round(W*0.3),11,'#F8E2B4');
  pWalk(A,Math.round(W*0.62),fy,'#5A6E8C');
  F(A,10,fy-4,10,4,'#8A6A44');F(A,10,fy-4,10,1,'#A07A50');
}
function construction(A,W,H){const fy=38;
  F(A,0,0,W,H,'#2A2E36');
  for(let px=6;px<W;px+=26){F(A,px,4,3,fy-4,'#8A6A2A');F(A,px,4,1,fy-4,'#A8843A');F(A,px+2,4,1,fy-4,'#6A4E1E');}
  for(let py=8;py<fy;py+=12){F(A,4,py,W-8,2,'#8A6A2A');F(A,4,py,W-8,1,'#A8843A');}
  for(let bx=4;bx<W*0.5;bx+=6)F(A,bx,fy-4,5,3,'#9A5A3A');
  for(let px=14;px<W;px+=30)F(A,px,6,1,fy-6,'#B8B0A0');F(A,10,fy-14,W-16,2,'#C8A87A');F(A,10,fy-24,W*0.6,2,'#C8A87A');
  F(A,Math.round(W*0.7),0,1,10,'#3A3E44');F(A,Math.round(W*0.7)-2,10,5,2,'#8A8E96');F(A,Math.round(W*0.7)-1,12,3,3,'#6A6E76');
  F(A,Math.round(W*0.82),fy-6,12,6,'#B8A88A');for(let k=0;k<3;k++)F(A,Math.round(W*0.82)+k*4,fy-8,3,2,'#C8B89A');
  for(let i=0;i<W;i+=6){F(A,i,fy-1,3,3,'#E8C14A');F(A,i+3,fy-1,3,3,'#2A2418');}
  pfloor(A,0,fy+2,W,H-fy-2,'#4A4E56');
  pWalk(A,Math.round(W*0.4),fy,'#E8862A');F(A,Math.round(W*0.4)-1,fy-25,7,2,'#F4D24A');F(A,Math.round(W*0.4),fy-26,5,1,'#FFE27A');
}
function lobbyGround(A,W,H){const fy=36;
  F(A,0,0,W,fy,'#EDE4CF');F(A,0,0,W,3,'#D8CCB0');F(A,0,3,W,1,'#C8BCA0');
  for(let px=6;px<W;px+=13)F(A,px,4,1,fy-6,'#E0D6BE',0.5);
  [Math.round(W*0.25),Math.round(W*0.55)].forEach(cxN=>{F(A,cxN-1,3,2,4,'#C9A24B');F(A,cxN-5,7,10,2,'#C9A24B');[-3,0,3].forEach(o=>{F(A,cxN+o,9,1,2,'#F8E2B4');});glow(A,cxN,9,'#FFE69A');});
  F(A,0,fy,W,H-fy,'#DCD2B8');F(A,0,fy,W,1,'#F0E8D0');F(A,0,fy+1,W,1,'#C8BEA4');for(let px=6;px<W;px+=10)F(A,px,fy+2,4,H-fy-3,'#E4DAC0',0.5);
  F(A,Math.round(W*0.28),fy,Math.round(W*0.32),H-fy,'#9A2E38');F(A,Math.round(W*0.28),fy,Math.round(W*0.32),1,'#B84450');
  box(A,10,fy-8,26,8,'#6B4A2B');F(A,10,fy-8,26,1,'#8A6440');F(A,14,fy-11,1,3,'#7A6A50');F(A,12,fy-13,5,3,'#F8E2B4');glow(A,14,fy-11,'#F8E2B4');pDesk(A,20,fy-8,'#5A6E8C');
  F(A,42,fy-10,1,10,'#6A5240');F(A,40,fy-16,5,7,'#4E7A3E');F(A,39,fy-14,3,3,'#5AA85A');box(A,42,fy-2,5,2,'#8C5A3A');
  box(A,Math.round(W*0.68),fy-12,10,10,'#3A4250');F(A,Math.round(W*0.68)+1,fy-11,8,8,'#5A6E8C');for(let k=0;k<3;k++)F(A,Math.round(W*0.68)+2,fy-9+k*2,6,1,'#C8D4E0');
  const shirts=['#5A6E8C','#3F8C84','#B0857A','#D8B05A'];
  [0.34,0.44,0.54].forEach((t,k)=>pWalk(A,Math.round(W*t),fy,shirts[k]));
  const ex=W-46;F(A,ex,4,46,fy-4,'#3A4658');
  F(A,ex+2,6,42,fy-8,'#7EA8C8');
  F(A,ex+2,6,42,10,'#9EC0DC');for(let gx=ex+4;gx<ex+44;gx+=6)F(A,gx,6,1,fy-8,'#5A7E9A',0.4);
  F(A,ex+16,fy-14,14,14,'#C9A24B');F(A,ex+16,fy-14,14,1,'#E8C860');F(A,ex+23,fy-14,1,14,'#8A6A2A');F(A,ex+19,fy-8,2,2,'#8A6A2A');F(A,ex+25,fy-8,2,2,'#8A6A2A');
  F(A,ex+8,3,30,3,'#9A2E38');F(A,ex+8,3,30,1,'#B84450');for(let cx2=ex+8;cx2<ex+38;cx2+=4)F(A,cx2,6,2,2,'#9A2E38');F(A,ex+22,0,2,3,'#8A8E96');
  pWalk(A,ex+33,fy,'#2A3550');F(A,ex+33,fy-24,5,1,'#D8B05A');
}
function skyLobby(A,W,H){const fy=36;
  F(A,0,0,W,fy,'#E8E6DE');F(A,0,0,W,3,'#D2CEC2');
  for(let wx=6;wx+30<W-40;wx+=38){box(A,wx,5,32,fy-8,'#2A3A50');F(A,wx+2,7,28,fy-12,'#AFC8DE');skyline(A,wx+2,fy-16,28,10);for(let gx=wx+2;gx<wx+30;gx+=6)F(A,gx,7,1,fy-12,'#7E9AB4',0.4);}
  F(A,0,fy,W,H-fy,'#DCD6C6');F(A,0,fy,W,1,'#F0ECDC');for(let px=6;px<W;px+=10)F(A,px,fy+2,4,H-fy-3,'#E6E0D0',0.5);
  const ex=W-44;box(A,ex,4,40,fy-4,'#3A4048');for(const dx of [ex+4,ex+18,ex+31]){F(A,dx,8,10,fy-12,'#20242C');F(A,dx+4,8,1,fy-12,'#3A4048');F(A,dx+1,10,8,4,'#5FB0DC',0.5);F(A,dx+3,9,4,2,'#E8C14A');}F(A,ex,4,40,2,'#5A6470');
  box(A,10,fy-8,20,8,'#6B4A2B');pDesk(A,16,fy-8,'#5A6E8C');F(A,12,fy-11,5,3,'#8FB6D8');
  F(A,Math.round(W*0.52),fy-10,1,10,'#6A5240');F(A,Math.round(W*0.52)-3,fy-16,7,7,'#4E7A3E');box(A,Math.round(W*0.52)-3,fy-2,7,2,'#8C5A3A');
  box(A,Math.round(W*0.34),fy-4,14,4,'#8C6E50');
  const shirts=['#5A6E8C','#3F8C84','#B0857A','#D8B05A'];
  [0.2,0.32,0.44].forEach((t,k)=>pWalk(A,Math.round(W*t),fy,shirts[k]));
  pWalk(A,Math.round(W*0.57),fy,'#E8862A');
}
function grandEnt(A,W,H){const fy=38;
  F(A,0,0,W,10,'#AFC8DE');skyline(A,0,2,W,8);F(A,0,10,W,1,'#3A4658');
  F(A,4,10,W-8,fy-10,'#3A4658');F(A,6,12,W-12,fy-14,'#8FB6C8');for(let gx=6;gx<W-6;gx+=6)F(A,gx,12,1,fy-14,'#5A7E9A',0.5);
  F(A,3,8,W-6,3,'#9A2E38');F(A,3,8,W-6,1,'#B84450');for(let cx2=4;cx2<W-4;cx2+=4)F(A,cx2,11,2,2,'#9A2E38');F(A,Math.round(W/2)-1,5,2,3,'#8A8E96');
  const dcx=Math.round(W/2);F(A,dcx-9,fy-18,18,18,'#C9A24B');F(A,dcx-9,fy-18,18,1,'#E8C860');F(A,dcx-1,fy-18,2,18,'#8A6A2A');F(A,dcx-5,fy-9,2,2,'#8A6A2A');F(A,dcx+3,fy-9,2,2,'#8A6A2A');
  pfloor(A,0,fy,W,H-fy,'#8A8478');F(A,dcx-6,fy,12,H-fy,'#9A2E38');F(A,dcx-6,fy,12,1,'#B84450');
  F(A,6,fy-8,1,8,'#6A5240');F(A,4,fy-12,5,5,'#4E7A3E');F(A,W-7,fy-8,1,8,'#6A5240');F(A,W-9,fy-12,5,5,'#4E7A3E');
  pWalk(A,dcx+7,fy,'#2A3550');F(A,dcx+7,fy-24,5,1,'#D8B05A');
  pWalk(A,10,fy,'#8A94A8');pWalk(A,W-17,fy,'#B0857A');
}
function serviceEnt(A,W,H){const fy=38;
  F(A,0,0,W,fy,'#4A4E56');F(A,0,0,W,3,'#3A3E46');for(let px=0;px<W;px+=8)F(A,px,1,2,3,'#3E424A');
  F(A,4,8,W-8,2,'#5A5E66');F(A,4,8,W-8,1,'#6A6E76');
  box(A,Math.round(W*0.3),12,Math.round(W*0.44),fy-12,'#6A6E76');for(let ly=14;ly<fy-2;ly+=3)F(A,Math.round(W*0.3)+1,ly,Math.round(W*0.44)-2,1,'#5A5E66');F(A,Math.round(W*0.3)+2,fy-6,Math.round(W*0.44)-4,2,'#3A3E44');
  F(A,Math.round(W*0.32),9,20,3,'#2A3550');for(let k=0;k<6;k++)F(A,Math.round(W*0.32)+2+k*3,10,2,1,'#DcE8F0');
  pfloor(A,0,fy,W,H-fy,'#3E424A');
  F(A,8,fy-6,3,6,'#8A6A44');F(A,8,fy-8,10,4,'#9A7A50');F(A,8,fy-8,10,1,'#B08A5C');F(A,7,fy-2,2,2,'#1A1D24');F(A,17,fy-2,2,2,'#1A1D24');
  F(A,W-14,fy-5,10,5,'#7A5A3A');F(A,W-14,fy-5,10,1,'#8C6A44');
  pWalk(A,24,fy,'#6E7A88');
}
function stdEnt(A,W,H){const fy=38;
  F(A,0,0,W,10,'#AFC8DE');skyline(A,0,3,W,7);
  F(A,3,8,W-6,2,'#4F6EC8');F(A,3,8,W-6,1,'#6E8AD8');
  F(A,4,10,W-8,fy-10,'#3A4658');F(A,6,12,W-12,fy-14,'#8FB6C8');
  const dcx=Math.round(W/2);F(A,dcx-6,fy-14,12,14,'#C9A24B');F(A,dcx,fy-14,1,14,'#8A6A2A');F(A,dcx-3,fy-7,2,2,'#8A6A2A');
  pfloor(A,0,fy,W,H-fy,'#8A8478');F(A,dcx-5,fy-1,10,1,'#6A5A48');
  pWalk(A,dcx+6,fy,'#5A6E8C');
}
function wedding(A,W,H){const fy=38;
  F(A,0,0,W,fy,'#F5EAD6');F(A,0,0,W,Math.round(fy*0.4),'#F8EEDC');
  for(let py=6;py<fy;py+=7)F(A,0,py,W,1,'#E6D8BE',0.4);
  F(A,0,0,W,3,'#E2D4B8');for(let px=4;px<W;px+=16)F(A,px,0,8,3,'#D8C8A8');F(A,0,3,W,1,'#C8B896');
  for(let px=Math.round(W*0.32);px<W*0.7;px+=Math.round(W*0.36)){F(A,px,4,3,fy-6,'#C9A24B');F(A,px,4,1,fy-6,'#E8C860');F(A,px+2,4,1,fy-6,'#A0802E');F(A,px-1,4,5,2,'#D8B860');}
  [Math.round(W*0.16),Math.round(W*0.5),Math.round(W*0.84)].forEach(cxN=>{F(A,cxN-1,3,2,3,'#C9A24B');F(A,cxN-6,6,12,2,'#C9A24B');F(A,cxN-4,9,8,1,'#C9A24B');[-5,-2,1,4].forEach(o=>F(A,cxN+o,7,1,2,'#F8E2B4'));[-3,0,3].forEach(o=>F(A,cxN+o,10,1,1,'#F8E2B4'));glow(A,cxN,8,'#FFE69A');});
  for(let wx=Math.round(W*0.4);wx+12<W*0.6;wx+=16){box(A,wx,8,12,fy-16,'#3A2A44');F(A,wx+1,9,10,3,'#E88AB0');F(A,wx+1,12,10,3,'#7FB0E8');F(A,wx+1,15,10,3,'#F4D060');F(A,wx+1,18,10,fy-27,'#8FA0D0');F(A,wx+5,9,1,fy-18,'#2A1E34');F(A,wx+1,12,10,1,'#2A1E34');}
  F(A,0,fy,W,H-fy,'#7A5A3A');F(A,0,fy,W,1,'#8C6A44');const acx=Math.round(W/2);F(A,acx-12,fy,24,H-fy,'#9A2E38');F(A,acx-12,fy,24,1,'#B84450');F(A,acx-12,fy,2,H-fy,'#C9A24B');F(A,acx+10,fy,2,H-fy,'#C9A24B');
  F(A,acx-16,fy-2,3,fy-12,'#E8DCC8');F(A,acx+13,fy-2,3,fy-12,'#E8DCC8');F(A,acx-16,10,32,3,'#E8DCC8');
  for(let ax=acx-16;ax<acx+16;ax+=4)bloom(A,ax,8,['#E88AB0','#F4D0A0','#F0F0F0','#E0A0C0'][(ax)%4]);
  for(let ay=12;ay<fy-6;ay+=6){bloom(A,acx-16,ay,'#E88AB0');bloom(A,acx+14,ay,'#F0F0F0');}
  box(A,acx-6,fy-6,12,6,'#E8DCC8');F(A,acx-4,fy-9,1,3,'#E8C14A');F(A,acx+2,fy-9,1,3,'#E8C14A');glow(A,acx-4,fy-9,'#F8E2B4');glow(A,acx+2,fy-9,'#F8E2B4');
  pDesk(A,acx-7,fy,'#2A2E38');
  F(A,acx+2,fy-9,5,9,'#F4F0EC');F(A,acx+2,fy-9,5,1,'#FFFFFF');F(A,acx+2,fy-14,4,5,'#E8C9A0');F(A,acx+2,fy-14,4,1,'#5A4A3A');F(A,acx+1,fy-15,6,2,'#F0F0F0');
  const gcol=['#8A94A8','#B0857A','#6E5A4A','#D8B05A','#5A6E8C','#3F8C84'];
  for(let sx=8,i=0;sx<acx-20;sx+=12,i++){F(A,sx,fy-9,6,9,'#F4F0EC');F(A,sx,fy-9,6,1,'#E88AB0');pDesk(A,sx,fy-2,gcol[i%6]);}
  for(let sx=acx+22,i=0;sx<W-8;sx+=12,i++){F(A,sx,fy-9,6,9,'#F4F0EC');F(A,sx,fy-9,6,1,'#E88AB0');pDesk(A,sx,fy-2,gcol[(i+3)%6]);}
  F(A,acx-26,fy-4,4,4,'#C9A24B');F(A,acx-30,fy-16,8,12,'#4E7A3E');bloom(A,acx-30,fy-18,'#E88AB0');bloom(A,acx-26,fy-19,'#F0F0F0');
  F(A,acx+22,fy-4,4,4,'#C9A24B');F(A,acx+22,fy-16,8,12,'#4E7A3E');bloom(A,acx+22,fy-18,'#F0F0F0');bloom(A,acx+26,fy-19,'#E88AB0');
  for(let gx2=6;gx2<W-6;gx2+=8)F(A,gx2,5,4,1,'#5AA85A',0.7);
}
const jobs=[["art:Floor / Corridor",10,floorTile],["art:Under Construction",16,construction],["art:Lobby (ground",20,lobbyGround],["art:Lobby (sky",20,skyLobby],["art:Grand Entrance",8,grandEnt],["art:Service Entrance",8,serviceEnt],["art:Standard Entrance",5,stdEnt],["art:Wedding Hall",16,wedding]];
const done=[];
for(const j of jobs){const nm=j[0],tiles=j[1],fn=j[2];const f=root.children.find(c=>c.type==='FRAME'&&c.name&&c.name.startsWith(nm));if(f){const gx=f.x,gy=f.y,name=f.name;f.remove();render(name,gx,gy,tiles,fn);done.push(name);}}
const gc=root.findOne(n=>n.type==="TEXT"&&n.characters.startsWith("Veined marble"));if(gc)gc.characters="Veined marble floor and walls, chandeliers, a reception desk with a receptionist, potted palms, a directory, a bench, a red carpet, the grand glass entrance with gold doors, a doorman, and a few tower occupants crossing (the walker scale). No ambient ghost pedestrians: only real building population appears.";
const sc2=root.findOne(n=>n.type==="TEXT"&&n.characters.startsWith("Airy transfer"));if(sc2)sc2.characters="Airy transfer floor every 15 stories: floor-to-ceiling windows onto the skyline, a central express elevator bank, an info desk with an attendant, planters, benches, and a few transferring occupants at the walker scale (one amber = impatient, a mood tint). Only real population, no ghost pedestrians.";
return { rebuilt:"page 5 people (walkers+desk)", done };
