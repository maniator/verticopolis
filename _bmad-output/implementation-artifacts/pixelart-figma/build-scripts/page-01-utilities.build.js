
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const root=await figma.getNodeByIdAsync("1:2");
await figma.loadFontAsync({family:"Inter",style:"Regular"});
function shd(h,a){const n=parseInt(h.slice(1),16);const c=v=>Math.max(0,Math.min(255,v+a));const r=c((n>>16)&255),g=c((n>>8)&255),b=c(n&255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
function box(A,x,y,w,h,b){F(A,x,y+h,w,1,'#000000',0.18);F(A,x,y,w,h,b);F(A,x,y,w,1,shd(b,22));F(A,x,y,1,h,shd(b,12));F(A,x+w-1,y,1,h,shd(b,-16));F(A,x,y+h-1,w,1,shd(b,-22));}
function glow(A,cx,cy,c){[[5,0.08],[4,0.12],[3,0.18],[2,0.3],[1,0.6]].forEach(s=>F(A,cx-s[0],cy-s[0],s[0]*2,s[0]*2,c,s[1]));}
function pWalk(A,x,f,sh){const head=5,body=13,leg=6;F(A,x-1,f,8,1,'#000000',0.26);F(A,x+1,f-leg,2,leg,'#2A2E38');F(A,x+4,f-leg,2,leg,'#2A2E38');F(A,x,f-leg-body,7,body,sh);F(A,x,f-leg-body,1,body,shd(sh,-26));F(A,x+6,f-leg-body,1,body,shd(sh,16));F(A,x+1,f-leg-body+3,5,1,shd(sh,-14));F(A,x+1,f-leg-body-head,5,head,'#E8C9A0');F(A,x+1,f-leg-body-head,5,1,'#3A2E28');F(A,x+4,f-leg-body-head+2,1,1,'#F0D8B8');}
function pStand(A,x,f,sh,coat){const head=5,body=9,leg=4;F(A,x-1,f,7,1,'#000000',0.24);F(A,x+1,f-leg,2,leg,'#2A2E38');F(A,x+3,f-leg,2,leg,'#2A2E38');F(A,x,f-leg-body,6,body,sh);if(coat){const cb=Math.round(body*0.6);F(A,x,f-leg-cb,6,cb,'#F4F0EC');F(A,x,f-leg-cb,1,cb,'#D8D4CC');}F(A,x,f-leg-body,1,body,shd(sh,-26));F(A,x+5,f-leg-body,1,body,shd(sh,16));F(A,x+1,f-leg-body-head,4,head,'#E8C9A0');F(A,x+1,f-leg-body-head,4,1,'#3A2E28');F(A,x+3,f-leg-body-head+2,1,1,'#F0D8B8');}
function pSeat(A,x,f,sh){const head=5,body=10;F(A,x-1,f,7,1,'#000000',0.24);F(A,x,f-body,6,body,sh);F(A,x,f-body,1,body,shd(sh,-26));F(A,x+5,f-body,1,body,shd(sh,16));F(A,x+1,f-body-head,4,head,'#E8C9A0');F(A,x+1,f-body-head,4,1,'#3A2E28');F(A,x+3,f-body-head+2,1,1,'#F0D8B8');}
function wallp(A,x,y,w,h,b,seam){F(A,x,y,w,h,b);F(A,x,y,w,1,shd(b,14));F(A,x,y+h-2,w,2,shd(b,-12));if(seam){for(let px=x+8;px<x+w;px+=12)F(A,px,y+2,1,h-4,shd(b,-10));for(let py=y+8;py<y+h-4;py+=8)F(A,x,py,w,1,shd(b,-8));}}
function floorb(A,x,fy,w,h,b){F(A,x,fy,w,h,b);F(A,x,fy,w,1,shd(b,18));F(A,x,fy+1,w,1,shd(b,-8));F(A,x,fy+h-1,w,1,shd(b,-24));}
function render(name,gx,gy,tiles,floors,fn){const PS=3,W=tiles*11,H=floors*44,A=[];fn(A,W,H);const sc=figma.createFrame();sc.name=name;sc.resize(W*PS,H*PS);sc.clipsContent=true;sc.cornerRadius=3;sc.fills=[{type:'SOLID',color:hex('#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.4},offset:{x:0,y:2},radius:6,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});}
function recycling(A,W,H){
  const deck=H-7;
  F(A,0,0,W,H,'#6C6C64'); F(A,0,0,W,Math.round(H*0.5),'#75756B');
  for(let px=0;px<W;px+=22)F(A,px,2,1,deck-2,'#5A5A52');
  for(let py=10;py<deck;py+=11)F(A,0,py,W,1,'#616159');
  for(let px=6;px<W;px+=22)F(A,px,12,1,1,'#8A8A80');
  F(A,0,3,W,2,'#7A8088'); F(A,0,3,W,1,'#9AA0A8'); for(let px=6;px<W;px+=16)F(A,px,2,2,4,'#5A6068');
  F(A,0,7,W,3,'#565C64'); F(A,0,7,W,1,'#6A727A');
  F(A,8,10,15,22,'#4A4E54'); F(A,8,10,2,22,'#5E636A'); F(A,21,10,2,22,'#3A3E44'); F(A,10,32,11,3,'#33373D');
  F(A,12,34,3,3,'#3A4232'); F(A,16,34,3,3,'#4A5A3A');
  [46,150].forEach(lx=>{F(A,lx,10,1,3,'#3A3E44');F(A,lx-3,13,7,3,'#2A2E34');F(A,lx-2,15,5,1,'#F8E2B4');glow(A,lx,18,'#F8E2B4');});
  box(A,92,5,70,10,'#2A6E3A'); for(let i=0;i<11;i++)F(A,96+i*6,8,3,4,'#DCE8C0');
  const by=deck-24; F(A,26,by,120,6,'#3A3E44'); F(A,26,by,120,1,'#4E545C'); F(A,26,by+5,120,1,'#242830');
  for(let sx=28;sx<144;sx+=6)F(A,sx,by+1,3,4,'#2E323A');
  F(A,24,by-1,4,8,'#4A4E54'); F(A,144,by-1,4,8,'#4A4E54');
  const items=['#4E7A4A','#3E6A9E','#C8A24A','#E0452C','#DCDCE0','#8C5A3A'];
  for(let ix=30,k=0;ix<140;ix+=13,k++){F(A,ix,by-4,5,4,items[k%items.length]);F(A,ix,by-4,5,1,'#FFFFFF',0.22);}
  const cx=W-52; box(A,cx,by-18,46,deck-(by-18),'#7E828A');
  F(A,cx+2,by-16,20,14,'#5A5E66'); F(A,cx+2,by-16,20,1,'#3A3E44');
  F(A,cx+3,by-10,6,4,'#3A3E44'); F(A,cx+11,by-10,6,4,'#3A3E44');
  box(A,cx+26,by-15,16,20,'#565C64');
  F(A,cx+29,by-12,4,4,'#3ADF6A'); F(A,cx+34,by-12,4,4,'#E85D5D');
  F(A,cx+29,by-6,10,4,'#1A1D24'); F(A,cx+30,by-5,8,2,'#5FB0DC');
  const bins=[['#3A8A4A','#2A6E3A'],['#3E6AAE','#2A4E86'],['#D8B23A','#B08A2A']];
  bins.forEach((c,i)=>{const bx=30+i*20; box(A,bx,deck-16,16,16,c[0]); F(A,bx,deck-16,16,2,c[1]); F(A,bx+5,deck-19,6,3,c[1]);
    F(A,bx+4,deck-11,4,1,'#FFFFFF',0.85);F(A,bx+7,deck-12,1,3,'#FFFFFF',0.85);F(A,bx+8,deck-8,4,1,'#FFFFFF',0.85);F(A,bx+8,deck-9,1,2,'#FFFFFF',0.85);});
  for(let r=0;r<2;r++)for(let c=0;c<2;c++){const bx2=98+c*19,by2=deck-14+r*7;box(A,bx2,by2,18,7,'#B08A5A');F(A,bx2,by2+3,18,1,'#8A6A44');F(A,bx2+8,by2,1,7,'#7A5A38');}
  for(let i=0;i<5;i++){const gx=cx-4-i*6;F(A,gx,deck-5,6,5,i%2?'#3A4232':'#2F3628');F(A,gx+2,deck-6,2,2,'#FFFFFF',0.28);}
  F(A,0,deck,W,7,'#4A4A44'); F(A,0,deck,W,1,'#5E5E56');
  for(let i=0;i<W;i+=6){F(A,i,deck+1,3,2,'#D8B23A');F(A,i+3,deck+1,3,2,'#2A2418');}
  F(A,20,deck+3,W-40,1,'#000000',0.2);
  const wx=84,wf=deck;F(A,wx-1,wf,8,1,'#000000',0.26);F(A,wx+1,wf-5,2,5,'#2A2E38');F(A,wx+4,wf-5,2,5,'#2A2E38');F(A,wx,wf-17,7,12,'#E8862A');F(A,wx,wf-17,7,1,'#FFB05A');F(A,wx,wf-10,7,1,'#F4F0E4');F(A,wx,wf-17,1,12,shd('#E8862A',-24));F(A,wx+1,wf-22,5,5,'#E8C9A0');F(A,wx+1,wf-22,5,1,'#3A2E28');F(A,wx,wf-24,7,2,'#F4D24A');
  F(A,W-6,14,4,deck-18,'#1B2A14'); F(A,W-5,14+Math.round((deck-18)*0.45),2,Math.round((deck-18)*0.55),'#6bd47a');
}
function metro(A,W,H){
  const platY=Math.round(H*0.72), trainY=platY+8, trainH=H-trainY-4;
  F(A,0,0,W,H,'#3A4652'); F(A,0,0,W,44,'#45525F');
  for(let ax=0;ax<W;ax+=40){F(A,ax,2,38,2,'#4E5C6A');F(A,ax+18,0,2,6,'#4E5C6A');}
  for(let lx=22;lx<W;lx+=46){F(A,lx,6,10,2,'#F8E2B4');glow(A,lx+5,9,'#F8E2B4');}
  for(let px=0;px<W;px+=10)F(A,px,44,1,platY-44,'#33414D');
  for(let py=50;py<platY-4;py+=8)F(A,0,py,W,1,'#33414D');
  [70,175,285].forEach(px=>{F(A,px,20,11,platY-20,'#2E3A44');F(A,px,20,2,platY-20,'#3E4C58');F(A,px+9,20,2,platY-20,'#242E36');});
  box(A,Math.round(W/2)-30,14,60,14,'#1E4E86'); for(let i=0;i<8;i++)F(A,Math.round(W/2)-24+i*6,18,3,6,'#DCE6F0');
  F(A,Math.round(W/2)-46,14,14,14,'#C0392B'); F(A,Math.round(W/2)-42,18,6,6,'#FFFFFF');
  F(A,Math.round(W/2)-41,19,1,4,'#C0392B');F(A,Math.round(W/2)-39,19,1,4,'#C0392B');F(A,Math.round(W/2)-37,19,1,4,'#C0392B');
  box(A,20,54,52,28,'#20303E'); F(A,24,58,44,2,'#5FB0DC'); F(A,24,64,32,1,'#E8C14A'); F(A,24,68,38,1,'#6bd47a'); for(let i=0;i<6;i++)F(A,26+i*7,60,2,2,'#F4F0E4');
  [110,210].forEach(bx=>{box(A,bx,platY-7,22,7,'#6A5240');F(A,bx+2,platY-11,2,4,'#4A3A2E');F(A,bx+18,platY-11,2,4,'#4A3A2E');});
  F(A,0,platY,W,8,'#5A6470'); F(A,0,platY,W,1,'#6E7A88'); F(A,0,platY+7,W,3,'#caa84a'); F(A,0,platY+7,W,1,'#E8C14A');
  const shirts=['#5A6E8C','#3F8C84','#B0857A','#6E5A4A','#D8B05A','#8A94A8'];
  for(let px=88,k=0;px<W-14;px+=28,k++){const c=(k%4===2)?'#E8862A':shirts[k%shirts.length];pWalk(A,px,platY,c);}
  box(A,6,trainY,W-12,trainH,'#C6CCD4'); F(A,6,trainY+trainH-5,W-12,3,'#D0392B'); F(A,6,trainY+trainH-5,W-12,1,'#E85D4A'); F(A,6,trainY,W-12,2,'#E4EAF0');
  for(let wx=14;wx<W-16;wx+=18){F(A,wx,trainY+3,12,Math.max(4,trainH-9),'#2A3440');F(A,wx,trainY+3,12,1,'#4A5460');F(A,wx+1,trainY+4,10,Math.max(2,trainH-11),'#9FC0E0',0.72);}
  for(let dx=22;dx<W-18;dx+=36){F(A,dx,trainY+2,2,trainH-4,'#8A9098');F(A,dx+9,trainY+2,2,trainH-4,'#8A9098');}
  F(A,8,trainY+3,2,3,'#FFE27A');
  F(A,0,H-3,W,3,'#1A2028'); F(A,0,H-2,W,1,'#3A4652');
}
function medical(A,W,H){const fy=H-6;
  wallp(A,0,0,W,fy,'#EDE9E2',true); floorb(A,0,fy,W,6,'#CFD6D2');
  for(let lx=24;lx<W;lx+=44){F(A,lx,2,10,2,'#F8E2B4');glow(A,lx+5,5,'#F8E2B4');}
  F(A,6,8,14,14,'#F4F0EC');F(A,10,10,6,10,'#D6342F');F(A,7,13,12,4,'#D6342F');
  box(A,28,fy-9,26,9,'#DCE2E8');F(A,28,fy-9,26,1,'#F0F4F8');F(A,30,fy-12,6,3,'#E8C9A0');F(A,30,fy-13,6,1,'#3A2E28');
  F(A,36,fy-10,16,3,'#BFD0DE');
  F(A,26,10,1,fy-16,'#B8BCC0');F(A,26,10,28,1,'#B8BCC0');
  F(A,54,12,4,fy-18,'#9FC0C8',0.6);
  box(A,64,fy-16,14,10,'#20242C');F(A,66,fy-14,10,6,'#0E241A');F(A,66,fy-11,2,1,'#6bd47a');F(A,68,fy-12,1,3,'#6bd47a');F(A,69,fy-10,2,1,'#6bd47a');F(A,71,fy-13,1,5,'#6bd47a');F(A,72,fy-11,4,1,'#6bd47a');glow(A,71,fy-11,'#3ADf6A'.slice(0,7));
  F(A,60,fy-16,1,16,'#B8BCC0');F(A,58,fy-18,5,3,'#CFE0FF',0.8);
  pStand(A,84,fy,'#8FB6D8',true);pStand(A,93,fy,'#6E7A88',true);
  box(A,104,fy-16,22,16,'#F4F4F0');for(let r=0;r<2;r++)for(let k=0;k<5;k++){F(A,107+k*4,fy-14+r*7,3,4,['#9FD0C8','#E8C9A0','#5db4e8','#F4A0A0','#DcE8C0'][k]);}
  F(A,104,fy-16,22,1,'#D8D8D0');
  F(A,132,fy-8,6,5,'#3A4250');F(A,132,fy-11,5,4,'#4A5464');F(A,132,fy-2,3,3,'#1A1D24');F(A,137,fy-3,2,2,'#1A1D24');
  box(A,144,fy-9,26,9,'#DCE2E8');F(A,146,fy-12,6,3,'#C99A6E');F(A,146,fy-13,6,1,'#3A2E28');F(A,152,fy-10,16,3,'#BFD0DE');
}
function security(A,W,H){const fy=H-6;
  wallp(A,0,0,W,fy,'#2C3A5A',false); floorb(A,0,fy,W,6,'#242A38');
  for(let r=0;r<2;r++)for(let cN=0;cN<5;cN++){const mx=6+cN*10,my=6+r*11;box(A,mx,my,8,9,'#0E1420');F(A,mx+1,my+1,6,5,'#1A3A2A');F(A,mx+1+((r+cN)%3),my+2,1,3,'#6bd47a',0.8);F(A,mx+1,my+1,6,1,'#2A4A3A');}
  box(A,58,fy-8,26,8,'#2A3550');F(A,58,fy-8,26,1,'#3E4A66');pSeat(A,66,fy-8,'#3E4A66');
  F(A,60,fy-14,6,6,'#D8B05A');F(A,62,fy-13,2,4,'#8A6A2A');
  F(A,78,8,8,5,'#5A4A36');for(let k=0;k<4;k++)F(A,79+k*2,13,1,2,'#D8B05A');
  F(A,W-8,7,4,4,'#E85D5D');glow(A,W-6,9,'#FF6B6B');
}
function housekeeping(A,W,H){const fy=H-6;
  wallp(A,0,0,W,fy,'#D8D0BE',false); floorb(A,0,fy,W,6,'#B7AE98');
  box(A,4,6,30,fy-8,'#9A8468');
  for(let r=0;r<3;r++){F(A,6,9+r*8,26,1,'#7A664C');for(let k=0;k<4;k++)F(A,7+k*7,10+r*8,6,5,['#F4F0EC','#CFE0FF','#F4F0EC','#E8D8C0'][(k+r)%4]);}
  box(A,44,fy-10,20,8,'#3E8E8E');F(A,46,fy-14,6,4,'#F4F0EC');F(A,53,fy-14,6,4,'#CFE0FF');
  F(A,58,fy-13,2,3,'#E85D5D');F(A,61,fy-13,2,3,'#5db4e8');
  F(A,44,fy-2,2,2,'#1A1D24');F(A,62,fy-2,2,2,'#1A1D24');
  F(A,68,fy-14,1,12,'#8A5A30');F(A,66,fy-16,5,3,'#E8E0B0');box(A,66,fy-6,7,6,'#F4C020');F(A,66,fy-6,7,2,'#CFE0FF',0.6);
  box(A,W-22,fy-9,16,9,'#B8A47E');for(let k=0;k<4;k++)F(A,W-20+k*4,fy-9,1,9,'#9A8460');F(A,W-20,fy-11,12,3,'#F4F0EC');
  pStand(A,38,fy,'#3E8E8E');
}
const jobs=[["art:Recycling",20,2,recycling],["art:Metro",30,3,metro],["art:Medical",16,1,medical],["art:Security",8,1,security],["art:Housekeeping",8,1,housekeeping]];
const done=[];
for(const j of jobs){const nm=j[0];const f=root.children.find(c=>c.type==='FRAME'&&c.name&&c.name.startsWith(nm));if(f){const gx=f.x,gy=f.y,name=f.name;f.remove();render(name,gx,gy,j[1],j[2],j[3]);done.push(name);}}
const mc=root.findOne(n=>n.type==="TEXT"&&n.characters.startsWith("Deep tiled station"));if(mc)mc.characters="Deep tiled station: vaulted ceiling with light strip, tiled pillars, a lit route-map board, the blue METRO sign and red M roundel, benches, and a waiting crowd at the walker scale on the yellow-edged platform (a couple tinted amber = impatient). A silver subway car with red livery, lit windows, doors and a headlight. Only real commuters, no ghost pedestrians.";
return { rebuilt:"page 1 utilities people", done };
