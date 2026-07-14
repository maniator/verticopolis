
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const root=await figma.getNodeByIdAsync("25:3");
for(const c of [...root.children]) c.remove();
await figma.loadFontAsync({family:"Inter",style:"Bold"});await figma.loadFontAsync({family:"Inter",style:"Semi Bold"});await figma.loadFontAsync({family:"Inter",style:"Regular"});
function shd(h,a){const n=parseInt(h.slice(1),16);const c=v=>Math.max(0,Math.min(255,v+a));const r=c((n>>16)&255),g=c((n>>8)&255),b=c(n&255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
function box(A,x,y,w,h,b){F(A,x,y+h,w,1,'#000000',0.18);F(A,x,y,w,h,b);F(A,x,y,w,1,shd(b,22));F(A,x,y,1,h,shd(b,12));F(A,x+w-1,y,1,h,shd(b,-16));F(A,x,y+h-1,w,1,shd(b,-22));}
function glow(A,cx,cy,c){[[4,0.1],[3,0.16],[2,0.3],[1,0.6]].forEach(s=>F(A,cx-s[0],cy-s[0],s[0]*2,s[0]*2,c,s[1]));}
function person(A,x,f,sh,seated){const head=5,body=seated?10:11,leg=seated?0:4;F(A,x-1,f,7,1,'#000000',0.24);if(!seated){F(A,x+1,f-leg,2,leg,'#2A2E38');F(A,x+3,f-leg,2,leg,'#2A2E38');}F(A,x,f-leg-body,6,body,sh);F(A,x,f-leg-body,1,body,shd(sh,-26));F(A,x+5,f-leg-body,1,body,shd(sh,16));F(A,x+1,f-leg-body+2,4,1,shd(sh,-14));F(A,x+1,f-leg-body-head,4,head,'#E8C9A0');F(A,x+1,f-leg-body-head,4,1,'#3A2E28');F(A,x+3,f-leg-body-head+2,1,1,'#F0D8B8');}
function iwall(A,x,y,w,h,b,patt){F(A,x,y,w,h,b);F(A,x,y,w,Math.round(h*0.45),shd(b,7));for(let py=y+4;py<y+h;py+=6)F(A,x,py,w,1,shd(b,-7),0.4);if(patt)for(let dx=x+4,i=0;dx<x+w;dx+=8,i++)for(let dy=y+4+((i%2)*3);dy<y+h-2;dy+=6)F(A,dx,dy,1,1,shd(b,13),0.5);}
function ceil(A,x,y,w,b){F(A,x,y,w,2,shd(b,-24));F(A,x,y+2,w,1,shd(b,16));}
function lights(A,x,y,w,lit){const n=Math.max(2,Math.round(w/24));for(let i=0;i<n;i++){const lx=Math.round(x+w*(i+0.5)/n);F(A,lx-1,y,3,1,lit?'#F8E2B4':'#C8BCA0');if(lit)glow(A,lx,y+2,'#F8E2B4');}}
function dado(A,x,fy,w,railY,b){F(A,x,railY,w,fy-railY,shd(b,-11));for(let px=x+10;px<x+w-4;px+=18)F(A,px,railY+3,1,fy-railY-5,shd(b,-22));F(A,x,railY-1,w,2,'#6B4A2B');F(A,x,railY-1,w,1,'#8A6640');}
function pfloor(A,x,fy,w,h,b){F(A,x,fy,w,h,b);F(A,x,fy,w,1,shd(b,18));F(A,x,fy+1,w,1,shd(b,-8));F(A,x,fy+h-1,w,1,shd(b,-24));for(let px=x+8;px<x+w;px+=14)F(A,px,fy+1,1,h-2,shd(b,-14));}
function windo(A,x,y,w,h,night){const b=night?['#20284A','#2A3350','#39406A']:['#BAD8EA','#9CC4DE','#83B2D2'];const hh=Math.ceil(h/3);for(let i=0;i<3;i++)F(A,x,y+i*hh,w,Math.min(hh,y+h-(y+i*hh)),b[i]);const sk=night?'#171C36':'#6E9EC0';let bx=x+1,s=0;while(bx<x+w-2){const bw=2+((s*7)%3),bh=2+((s*13)%(h-2));F(A,bx,y+h-bh,Math.min(bw,x+w-1-bx),bh,sk);if(night&&s%2===0)F(A,bx,y+h-bh+1,1,1,'#F3D08A');bx+=bw+1;s++;}F(A,x+w-3,y+1,1,Math.min(4,h-2),'#FFFFFF',0.2);F(A,x-1,y-1,w+2,1,'#3A2E22');F(A,x-1,y-1,1,h+2,'#3A2E22');F(A,x-1,y+h,w+2,1,'#171310');F(A,x+w,y-1,1,h+2,'#171310');F(A,x+((w/2)|0),y,1,h,'#241C14');if(h>=9)F(A,x,y+((h/2)|0),w,1,'#241C14');}
function curtain(A,x,y,h,c){F(A,x-2,y-1,3,h+2,c);F(A,x-2,y-1,1,h+2,shd(c,18));}
function art(A,x,y,w,h,pic){box(A,x,y,w,h,'#7A5A38');F(A,x+1,y+1,w-2,h-2,pic);F(A,x+1,y+1,w-2,1,shd(pic,18));}
function render(name,gx,gy,tiles,fn){const PS=3,W=tiles*11,H=44,A=[];fn(A,W,H);const sc=figma.createFrame();sc.name=name;sc.resize(W*PS,H*PS);sc.clipsContent=true;sc.cornerRadius=3;sc.fills=[{type:'SOLID',color:hex('#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.45},offset:{x:0,y:2},radius:7,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});}
function annotate(name,cap,x,y,w){const t=figma.createText();t.fontName={family:'Inter',style:'Semi Bold'};t.fontSize=13;t.characters=name;t.fills=[{type:'SOLID',color:hex('#F4F0E4')}];root.appendChild(t);t.x=x;t.y=y;const c=figma.createText();c.fontName={family:'Inter',style:'Regular'};c.fontSize=11;c.characters=cap;c.fills=[{type:'SOLID',color:hex('#9AA4B4')}];c.textAutoResize='HEIGHT';root.appendChild(c);c.resize(Math.max(w||280,210),44);c.x=x;c.y=y+16;}
const T=figma.createText();T.fontName={family:'Inter',style:'Bold'};T.fontSize=24;T.characters="Offices & Residential";T.fills=[{type:'SOLID',color:hex('#F4F0E4')}];root.appendChild(T);T.x=40;T.y=28;
function cube(A,dx,fy,staffed,seed){F(A,dx-2,fy-17,2,17,'#5E4028');F(A,dx-2,fy-17,1,17,'#7E5A38');F(A,dx+7,fy-10,5,10,'#3A3F4A');F(A,dx+7,fy-10,5,1,'#4A5058');if(staffed)person(A,dx+8,fy-1,['#5A6E8C','#3F8C84','#6E5A4A','#D8B05A'][seed%4],true);F(A,dx,fy,18,1,'#000000',0.16);box(A,dx,fy-6,18,3,'#A9743C');F(A,dx,fy-3,18,3,shd('#A9743C',-26));F(A,dx+1,fy-13,7,7,'#20242C');F(A,dx+1,fy-13,7,1,'#3A4048');F(A,dx+2,fy-12,5,4,staffed?'#5FB0DC':'#2E3640');if(staffed)F(A,dx+2,fy-12,5,1,'#8FD0EC');F(A,dx+9,fy-7,6,1,'#1A1D24');F(A,dx+15,fy-8,2,2,'#C87A5A');}
function office(A,W,H,layout){const fy=38,railY=23,night=layout==='night',filled=layout!=='vacant'&&layout!=='night';
  if(layout==='vacant'){F(A,0,0,W,fy,'#C9CCC4');F(A,0,fy,W,H-fy,'#B2B0A4');for(let i=-fy;i<W;i+=8)F(A,i,fy,1,-fy,'#FFFFFF',0.06);box(A,W/2-13,fy/2-4,26,10,'#D9D2B0');F(A,W/2-9,fy/2-1,15,3,'#7a6b3a');return;}
  ceil(A,0,0,W,'#ECDFC2');lights(A,0,3,W,filled);
  iwall(A,0,4,W,railY-4,'#ECDFC2',true);F(A,0,railY-3,W,1,'#C4A87A');
  dado(A,0,fy,W,railY,'#ECDFC2');pfloor(A,0,fy,W,H-fy,'#6E7A48');
  windo(A,W-27,7,23,railY-11,night);for(let sy=9;sy<railY-4;sy+=2)F(A,W-26,sy,21,1,'#E8E2D0',0.22);curtain(A,W-28,7,railY-11,'#B8845A');
  F(A,5,8,5,5,'#2A2E38');F(A,6,9,3,3,'#E8E4D0');F(A,7,9,1,2,'#2A2E38');
  art(A,13,7,12,7,'#3E5A6E');
  box(A,W-52,6,16,9,'#6A5240');for(let k=0;k<5;k++)F(A,W-50+k*3,8,2,5,['#8C3A32','#3E5A8C','#B08A3E','#4A7A4A','#7A5A9E'][k]);
  if(layout==='meet'){const tw=58,tx=Math.round((W-tw)/2);F(A,tx,fy,tw,1,'#000000',0.16);box(A,tx,fy-7,tw,4,'#6B4A2B');F(A,tx+6,fy-8,4,1,'#F4F0E4');F(A,tx+tw-12,fy-8,4,1,'#F4F0E4');F(A,tx+tw/2-3,fy-9,6,2,'#2A2E38');for(let i=0;i<5;i++){const sx=tx+3+i*11;F(A,sx-1,fy-12,7,5,'#3A3F4A');F(A,sx-1,fy-12,7,1,'#4A5058');if(filled)person(A,sx,fy-1,['#5A6E8C','#3F8C84','#6E5A4A'][i%3],true);}F(A,W-9,fy-6,3,6,'#7A5A3A');F(A,W-12,fy-13,8,8,'#4E7A3E');F(A,W-10,fy-16,4,4,'#5AA85A');}
  else if(layout==='exec'){F(A,6,fy,26,1,'#000000',0.16);box(A,6,fy-8,26,6,'#71512F');F(A,9,fy-15,8,7,'#20242C');F(A,10,fy-14,6,5,'#5FB0DC');F(A,23,fy-17,7,17,'#5A3A2A');F(A,23,fy-17,7,1,'#6A4A38');person(A,22,fy-1,'#6E5A4A',true);box(A,36,fy-18,14,18,'#5A4436');for(let r=0;r<4;r++)for(let k=0;k<4;k++)F(A,38+k*3,fy-16+r*4,2,3,['#8C3A32','#3E5A8C','#B08A3E','#4A7A4A'][(k+r)%4]);cube(A,54,fy,true,1);cube(A,76,fy,true,2);}
  else{for(let i=0;i<4;i++)cube(A,7+i*22,fy,i<3,i);}
}
function condo(A,W,H,layout){const fy=38,railY=24,night=layout==='night',home=!night;
  ceil(A,0,0,W,'#C8A88C');F(A,Math.round(W/2)-4,3,8,3,'#E8D8B8');F(A,Math.round(W/2)-3,4,6,1,'#F4E8C8');if(home)glow(A,Math.round(W/2),6,'#F8E2B4');
  iwall(A,0,4,W,railY-4,'#C8A88C',true);F(A,0,railY-3,W,1,'#A88A6E');
  F(A,0,railY,W,fy-railY,shd('#C8A88C',-8));
  pfloor(A,0,fy,W,H-fy,'#B98A5A');F(A,Math.round(W*0.28),fy+1,Math.round(W*0.4),1,'#8C3A32',0.4);
  art(A,8,8,11,8,'#5A6E7A');art(A,23,9,9,6,'#6E7A5A');
  windo(A,W-30,7,22,railY-11,night);curtain(A,W-32,7,railY-11,'#9A6E7A');curtain(A,W-8,7,railY-11,'#9A6E7A');
  if(layout==='living'){const bx=26,sofaW=40;F(A,bx,fy,sofaW,1,'#000000',0.16);box(A,bx,fy-10,sofaW,10,'#7C5A6A');F(A,bx+2,fy-13,sofaW-4,4,'#8C6A7A');F(A,bx,fy-13,3,13,'#6A4858');F(A,bx+sofaW-3,fy-13,3,13,'#6A4858');F(A,bx+6,fy-12,8,3,'#9A7A8A');F(A,bx+20,fy-12,8,3,'#9A7A8A');if(home)person(A,bx+16,fy-1,'#D8B05A',true);box(A,bx+sofaW+6,fy-6,14,6,'#6B4A2B');F(A,bx+sofaW+9,fy-8,2,2,'#F4F0E4');F(A,bx-8,fy-18,1,18,'#7A6A50');F(A,bx-11,fy-21,7,4,home?'#F8E2B4':'#9a8f70');if(home)glow(A,bx-8,fy-19,'#F8E2B4');const tv=W-52;box(A,tv,fy-16,18,13,'#2A2A32');F(A,tv+1,fy-15,16,10,home?'#8FB6FF':'#2A2F3A');if(home)F(A,tv+2,fy-14,14,4,'#B8D0FF',0.5);box(A,tv-1,fy-3,20,3,'#5A4436');}
  else if(layout==='dining'){box(A,6,railY+1,26,fy-railY-1,'#B8B4A8');F(A,9,railY,2,1,'#2A2E38');F(A,13,railY,2,1,'#2A2E38');F(A,6,14,26,5,'#9A968A');F(A,8,15,22,3,'#8A867A');const tx=46;F(A,tx,fy,26,1,'#000000',0.16);box(A,tx,fy-7,26,3,'#6B4A2B');F(A,tx+1,fy-4,2,4,shd('#6B4A2B',-20));F(A,tx+23,fy-4,2,4,shd('#6B4A2B',-20));F(A,tx+6,fy-8,4,1,'#F4F0E4');F(A,tx+16,fy-8,4,1,'#F4F0E4');F(A,tx+11,fy-10,2,3,'#E8C14A');glow(A,tx+12,fy-10,'#F8E2B4');F(A,tx-5,fy-13,3,9,'#5A3A2A');F(A,tx+28,fy-13,3,9,'#5A3A2A');if(home){person(A,tx-5,fy-1,'#5A6E8C',true);person(A,tx+27,fy-1,'#8A94A8',true);}box(A,W-30,railY+1,10,fy-railY-1,'#8A6A4A');}
  else{box(A,6,railY-2,30,fy-railY+2,'#6A5240');for(let r=0;r<4;r++)for(let k=0;k<9;k++)F(A,9+k*3,railY+r*4,2,3,['#8C3A32','#3E5A8C','#B08A3E','#4A7A4A','#5A4A6E'][(k+r)%5]);const dx=48;F(A,dx,fy,22,1,'#000000',0.16);box(A,dx,fy-7,22,3,'#8C6E50');F(A,dx+6,fy-8,7,1,'#F4F0E4');F(A,dx+20,fy-18,1,11,'#7A6A50');F(A,dx+18,fy-21,5,4,home?'#F8E2B4':'#9a8f70');if(home)glow(A,dx+20,fy-19,'#F8E2B4');F(A,dx+8,fy-13,6,6,'#4A5464');if(home)person(A,dx+9,fy-1,'#6E5A4A',true);box(A,W-28,fy-5,12,5,'#5A6E8C');}
}
function bed(A,bx,bw,fy,pillows,asleep,dirty){const bt=fy-12;F(A,bx,fy,bw,1,'#000000',0.18);box(A,bx,bt-2,4,14,'#6B4A2B');F(A,bx+1,bt-1,2,12,'#8A6640');F(A,bx+4,bt,bw-4,12,'#F2ECDE');F(A,bx+4,bt,bw-4,1,'#FFFFFF');F(A,bx+4,bt+4,bw-4,7,'#E8B7A8');F(A,bx+4,bt+4,bw-4,1,'#C98A82');F(A,bx+4,bt+10,bw-4,1,'#8A2A38');F(A,bx+5,bt+1,Math.max(5,Math.round(bw*0.26)),3,'#FBF7EC');F(A,bx+5,bt+1,Math.max(5,Math.round(bw*0.26)),1,'#FFFFFF');if(pillows>1)F(A,bx+5,bt+5,5,2,'#FBF7EC');if(asleep){F(A,bx+Math.round(bw*0.32),bt+3,Math.round(bw*0.55),6,'#A83C4A');F(A,bx+6,bt+1,3,3,'#C99A6E');}else if(dirty){F(A,bx+5,bt+1,Math.round(bw*0.8),7,'#B8A98A');F(A,bx+7,bt+2,Math.round(bw*0.4),2,'#A89878');}}
function hotel(A,W,H,grade,state){const fy=38,railY=22,asleep=state==='asleep',dirty=state==='dirty',lit=!asleep;
  const wall=asleep?'#3A3550':'#D8C49A';
  ceil(A,0,0,W,wall);if(W>44){F(A,Math.round(W/2)-3,3,6,2,lit?'#F4E4B8':'#4A4560');if(lit)glow(A,Math.round(W/2),5,'#F8E2B4');}
  iwall(A,0,4,W,railY-4,wall,true);F(A,0,railY-3,W,1,shd(wall,-16));
  F(A,0,railY,W,fy-railY,shd(wall,-9));
  pfloor(A,0,fy,W,H-fy,asleep?'#4A4560':'#A88A5E');
  if(W>44)art(A,Math.round(W*0.16),7,12,8,asleep?'#2A2740':'#8FA6B8');
  const wwx=W>80?W-20:W-13;windo(A,wwx,7,W>80?14:9,railY-11,asleep);curtain(A,wwx-2,7,railY-11,asleep?'#2E2A44':'#B08A6A');
  if(grade===1){bed(A,6,24,fy,1,asleep,dirty);box(A,32,fy-8,7,8,'#5A4436');}
  else if(grade===2){bed(A,6,24,fy,1,asleep,dirty);bed(A,36,24,fy,1,asleep,dirty);box(A,31,fy-6,4,6,'#6A4A30');}
  else{box(A,5,fy-8,20,8,'#7C5A6A');F(A,5,fy-11,20,3,'#8C6A7A');F(A,7,fy-10,6,3,'#9A7A8A');F(A,15,fy-10,6,3,'#9A7A8A');F(A,27,fy-15,1,15,'#7A6A50');F(A,25,fy-18,5,3,lit?'#F8E2B4':'#9a8f70');if(lit)glow(A,27,fy-16,'#F8E2B4');box(A,32,fy-6,12,6,'#6B4A2B');bed(A,48,48,fy,2,asleep,dirty);}
  F(A,W-6,fy-6,4,6,'#6A4A30');F(A,W-6,fy-6,4,1,'#7A5A40');
  if(dirty)F(A,W-7,fy-9,5,3,'#D4623A');else if(lit){F(A,W-5,fy-11,2,5,'#FFD86A');glow(A,W-4,fy-9,'#FFD86A');}
  if(asleep){F(A,10,fy-17,3,3,'#D2DCFF',0.9);}
}
function condoSale(A,W,H){const fy=38;
  F(A,0,0,W,fy,'#C9CCC4');F(A,0,fy,W,H-fy,'#B2B0A4');F(A,0,fy,W,1,'#C4C2B6');
  for(let i=-fy;i<W;i+=8)F(A,i,fy,1,-fy,'#FFFFFF',0.06);
  const bx=Math.round(W/2)-16;F(A,bx,fy/2-6,32,13,'#D9D2B0');F(A,bx,fy/2-6,32,1,'#EDE6C4');F(A,bx-1,fy/2-6,1,13,'#7a6b3a');F(A,bx+32,fy/2-6,1,13,'#7a6b3a');
  const lx=bx+6;['S','A','L','E'].forEach((_,i)=>{F(A,lx+i*6,fy/2-3,3,6,'#7a6b3a');F(A,lx+i*6+1,fy/2-1,1,2,'#D9D2B0');});
  F(A,bx+15,fy/2+7,2,fy-(fy/2+7),'#8A7A50');
}
let cx=40,cy=74,rowH=0;
function ph(txt){const S=figma.createText();S.fontName={family:'Inter',style:'Bold'};S.fontSize=18;S.characters=txt;S.fills=[{type:'SOLID',color:hex('#F3D08A')}];root.appendChild(S);S.x=40;S.y=cy;cy+=30;}
function place(label,cap,tiles,fn){const PS=3,W=tiles*11*PS,H=44*PS;if(cx+W>1240){cx=40;cy+=rowH+70;rowH=0;}render("art:"+label,cx,cy,tiles,fn);annotate(label,cap,cx,cy+H+8,W);cx+=W+26;rowH=Math.max(rowH,H);}
ph("Offices  (three geo-seeded layouts + states)");
place("Office (cubicle row)","Full-height wall with pinstripe, crown molding and downlights, wainscot dado, framed art, a binder shelf, a curtained skyline window, olive carpet, cubicle bank with lit monitors and seated staff (now clearly a third of the module tall).",9,(A,W,H)=>office(A,W,H,'cube'));
place("Office (meeting room)","Boardroom table with laptop and papers, high-back chairs and seated staff both sides, a corner plant.",9,(A,W,H)=>office(A,W,H,'meet'));
place("Office (executive)","Big desk with a seated executive, leather chair, tall bookshelf, plus two cubicles.",9,(A,W,H)=>office(A,W,H,'exec'));
place("Office (vacant)","FOR LEASE card on a hatched gray shell. Reserved state cue, unchanged.",9,(A,W,H)=>office(A,W,H,'vacant'));
place("Office (night)","After hours: downlights dim, window shows a night skyline with city lights.",9,(A,W,H)=>office(A,W,H,'night'));
cx=40;cy+=rowH+76;rowH=0;
ph("Condominiums  (three layouts + for-sale state)");
place("Condo (living room)","Papered wall with a framed art gallery, ceiling light, curtained window, tall floor lamp, tufted sofa with a seated resident, coffee table, a TV on a console, area rug.",16,(A,W,H)=>condo(A,W,H,'living'));
place("Condo (dining)","Kitchenette with stove and upper cabinet, a set table with chairs, place settings and a candle, two seated diners, plus a sideboard.",16,(A,W,H)=>condo(A,W,H,'dining'));
place("Condo (study)","A tall wall-to-wall bookcase, a desk with an open book and a monitor under a warm lamp, a seated reader, and a low cabinet.",16,(A,W,H)=>condo(A,W,H,'study'));
place("Condo (for sale)","Empty condo: FOR SALE card on a hatched gray shell (a condo is sold once, not leased). Reserved state cue.",16,(A,W,H)=>condoSale(A,W,H));
cx=40;cy+=rowH+76;rowH=0;
ph("Hotel rooms  (three grades + housekeeping states)");
place("Single Room (ready)","Papered wall with framed art and crown molding, ceiling light, curtained window, a tall walnut headboard, warm pink bedspread, a dresser, and the brass nightstand lamp glowing (ready).",4,(A,W,H)=>hotel(A,W,H,1,'ready'));
place("Double Room (ready)","Two pink beds sharing a nightstand, framed art, curtained window, ready lamp lit.",6,(A,W,H)=>hotel(A,W,H,2,'ready'));
place("Suite (ready)","A sitting sofa and floor lamp, coffee table, a wide two-pillow bed, wall art, curtained window, ready lamp.",10,(A,W,H)=>hotel(A,W,H,3,'ready'));
place("Single (asleep)","Night: dark wall, guest under a red blanket, floating z. Reserved asleep cue.",4,(A,W,H)=>hotel(A,W,H,1,'asleep'));
place("Double (needs cleaning)","Checkout: rumpled bedding and an orange housekeeping tray on the nightstand. Reserved dirty cue.",6,(A,W,H)=>hotel(A,W,H,2,'dirty'));
root.resize(1280, cy+rowH+96);
return { rebuilt:"page 2 occupants bumped to 15px" };
