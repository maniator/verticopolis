
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const root=await figma.getNodeByIdAsync("29:3");
for(const c of [...root.children]) c.remove();
await figma.loadFontAsync({family:"Inter",style:"Bold"});await figma.loadFontAsync({family:"Inter",style:"Semi Bold"});await figma.loadFontAsync({family:"Inter",style:"Regular"});
function shd(h,a){const n=parseInt(h.slice(1),16);const c=v=>Math.max(0,Math.min(255,v+a));const r=c((n>>16)&255),g=c((n>>8)&255),b=c(n&255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
function box(A,x,y,w,h,b){F(A,x,y+h,w,1,'#000000',0.18);F(A,x,y,w,h,b);F(A,x,y,w,1,shd(b,22));F(A,x,y,1,h,shd(b,12));F(A,x+w-1,y,1,h,shd(b,-16));F(A,x,y+h-1,w,1,shd(b,-22));}
function glow(A,cx,cy,c){[[4,0.1],[3,0.16],[2,0.3],[1,0.6]].forEach(s=>F(A,cx-s[0],cy-s[0],s[0]*2,s[0]*2,c,s[1]));}
function person(A,x,f,sh){const head=5,body=10;F(A,x-1,f,7,1,'#000000',0.24);F(A,x,f-body,6,body,sh);F(A,x,f-body,1,body,shd(sh,-26));F(A,x+5,f-body,1,body,shd(sh,16));F(A,x+1,f-body+2,4,1,shd(sh,-14));F(A,x+1,f-body-head,4,head,'#E8C9A0');F(A,x+1,f-body-head,4,1,'#3A2E28');F(A,x+3,f-body-head+2,1,1,'#F0D8B8');}
function wtex(A,x,y,w,h,b,mode){F(A,x,y,w,h,b);F(A,x,y,w,Math.round(h*0.4),shd(b,7));if(mode==='tile')for(let py=y+3;py<y+h;py+=4){F(A,x,py,w,1,shd(b,-10),0.5);for(let px=x+((((py-y)/4)|0)%2?4:0);px<x+w;px+=8)F(A,px,py-3,1,3,shd(b,-8),0.4);}else if(mode==='plank')for(let px=x;px<x+w;px+=13){F(A,px,y,1,h,shd(b,-12),0.5);}else for(let py=y+4;py<y+h;py+=6)F(A,x,py,w,1,shd(b,-8),0.4);}
function pfloor(A,x,fy,w,h,b,checker){F(A,x,fy,w,h,b);F(A,x,fy,w,1,shd(b,18));F(A,x,fy+1,w,1,shd(b,-8));F(A,x,fy+h-1,w,1,shd(b,-24));if(checker)for(let px=x;px<x+w;px+=6)F(A,px+((((px-x)/6)|0)%2?3:0),fy+2,3,h-3,shd(b,14),0.5);else for(let px=x+7;px<x+w;px+=12)F(A,px,fy+1,1,h-2,shd(b,-16));}
function pendant(A,x,c){F(A,x,7,1,3,'#3A3E44');F(A,x-2,10,5,2,shd(c,-16));F(A,x-1,11,3,1,'#F8E2B4');glow(A,x,12,'#F8E2B4');}
function band(A,W,bc,ac){F(A,0,0,W,7,bc);F(A,0,0,W,1,shd(bc,34));F(A,0,6,W,1,shd(bc,-34));for(let sx=3;sx<W-2;sx+=8)F(A,sx,2,4,3,ac);}
function boba(A,x,y,cupc){F(A,x,y,4,6,cupc);F(A,x,y,4,1,'#FFFFFF',0.4);F(A,x,y+4,4,2,'#3A2A24');F(A,x+1,y-2,2,2,'#F4F0E4');F(A,x+2,y-3,1,2,'#E85D8A');}
function twall(A,x,y,w,h,b){F(A,x,y,w,h,b);F(A,x,y,w,Math.round(h*0.4),shd(b,8));for(let py=y+3;py<y+h;py+=6)F(A,x,py,w,1,shd(b,-8),0.5);for(let dx=x+4,i=0;dx<x+w;dx+=8,i++)for(let dy=y+5+((i%2)*3);dy<y+h-2;dy+=6)F(A,dx,dy,1,1,shd(b,13),0.5);}
function wainscot(A,x,fy,w,railY,b){F(A,x,railY,w,fy-railY,shd(b,-13));for(let px=x+10;px<x+w-4;px+=16)F(A,px,railY+3,1,fy-railY-5,shd(b,-22));F(A,x,railY-1,w,2,'#5A3E28');F(A,x,railY-1,w,1,'#7A5A38');}
function sconce(A,x,y){F(A,x,y,1,4,'#5A4632');F(A,x-1,y-2,3,3,'#F8E2B4');glow(A,x,y-1,'#F8E2B4');}
function artF(A,x,y,w,h,pic){box(A,x,y,w,h,'#7A5A38');F(A,x+1,y+1,w-2,h-2,pic);F(A,x+1,y+1,w-2,1,shd(pic,18));}
function exitSign(A,x,y){F(A,x,y,10,4,'#0E3A1E');F(A,x,y,10,1,'#1A5A2E');for(let k=0;k<4;k++)F(A,x+1+k*2,y+1,1,2,'#6bd47a');glow(A,x+5,y+2,'#6bd47a');}
function render(name,gx,gy,tiles,floors,fn){const PS=3,W=tiles*11,H=floors*44,A=[];fn(A,W,H);const sc=figma.createFrame();sc.name=name;sc.resize(W*PS,H*PS);sc.clipsContent=true;sc.cornerRadius=3;sc.fills=[{type:'SOLID',color:hex('#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.45},offset:{x:0,y:2},radius:7,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});}
function annotate(name,cap,x,y,w){const t=figma.createText();t.fontName={family:'Inter',style:'Semi Bold'};t.fontSize=13;t.characters=name;t.fills=[{type:'SOLID',color:hex('#F4F0E4')}];root.appendChild(t);t.x=x;t.y=y;const c=figma.createText();c.fontName={family:'Inter',style:'Regular'};c.fontSize=11;c.characters=cap;c.fills=[{type:'SOLID',color:hex('#9AA4B4')}];c.textAutoResize='HEIGHT';root.appendChild(c);c.resize(Math.max(w||280,220),44);c.x=x;c.y=y+16;}
const RL={french:{wall:'#4A2A3A',floor:'#3A2440'},pub:{wall:'#4A3626',floor:'#33251A'},chinese:{wall:'#5A2020',floor:'#3A1818'},sushi:{wall:'#B89A6A',floor:'#8A6E48'},steak:{wall:'#4A2A22',floor:'#33201A'}};
function burger(A,W,H){const fy=38;wtex(A,0,7,W,fy-7,'#EAD8BE','tile');pfloor(A,0,fy,W,H-fy,'#B85A3A',true);band(A,W,'#E0452C','#FFD24A');pendant(A,Math.round(W*0.24),'#E0452C');
 box(A,4,10,30,12,'#22262E');F(A,7,12,10,3,'#E0452C');F(A,7,15,10,1,'#E8C14A');F(A,19,12,12,1,'#F8E2B4');F(A,19,15,10,1,'#DcE8C0');F(A,19,18,8,1,'#F4C0C0');glow(A,20,16,'#F8E2B4');
 const cw=Math.round(W*0.3);box(A,4,fy-10,cw,10,'#C87A2E');F(A,4,fy-10,cw,1,'#E09A4E');F(A,cw-6,fy-13,4,3,'#2A2E38');person(A,10,fy-10,'#F4F0EC');
 F(A,16,fy-16,10,4,'#3A3E44');F(A,18,fy-17,3,1,'#8C3A32');F(A,22,fy-17,3,1,'#8C3A32');glow(A,20,fy-15,'#E8862A');F(A,28,fy-16,5,6,'#8A8A92');F(A,29,fy-15,3,2,'#5db4e8');
 for(let tx=cw+18,i=0;tx+16<W;tx+=32,i++){F(A,tx-2,fy-1,16,1,'#000000',0.16);F(A,tx,fy-5,12,3,'#E8E4DA');F(A,tx,fy-5,12,1,'#FFFFFF');F(A,tx+5,fy-2,2,2,'#B0A99A');F(A,tx+2,fy-7,2,2,'#E0452C');F(A,tx+7,fy-7,2,2,'#E8C14A');person(A,tx-5,fy,'#5A6E8C');person(A,tx+12,fy,'#6E5A4A');}
}
function soba(A,W,H){const fy=38;wtex(A,0,7,W,fy-7,'#E6E0CC','plank');pfloor(A,0,fy,W,H-fy,'#7A5A3A');band(A,W,'#3A4E8C','#F4F0E4');
 for(let nx=2;nx<W-2;nx+=7){F(A,nx,7,6,5,'#2E4A7A');F(A,nx,7,6,1,'#3E5A8C');}F(A,0,12,W,1,'#1E3560');
 F(A,6,15,W*0.5,2,'#8A6E48');for(let bx=10;bx<W*0.5;bx+=8)F(A,bx,13,4,2,'#F4F0E4');
 F(A,Math.round(W*0.6),13,10,6,'#8A8A92');F(A,Math.round(W*0.6)+2,10,2,3,'#F4F0E4',0.6);F(A,Math.round(W*0.6)+6,9,2,4,'#F4F0E4',0.5);person(A,Math.round(W*0.78),fy-13,'#D8D8D8');
 const cy2=fy-8;box(A,4,cy2,W-8,4,'#8C6E48');F(A,4,cy2,W-8,1,'#A8845C');
 for(let bx=12;bx<W-8;bx+=16){F(A,bx,cy2-2,4,2,'#F4F0E4');F(A,bx,cy2-3,4,1,'#FFFFFF',0.5);}
 for(let sx=10;sx+6<W-6;sx+=16){F(A,sx+1,fy-3,3,3,'#5A4632');person(A,sx,fy-3,['#3F8C84','#6E5A4A','#8A94A8'][sx%3]);}
}
function teaCafe(A,W,H){const fy=38,railY=24;
 wtex(A,0,7,W,railY-7,'#EEE2C8');F(A,0,railY,W,fy-railY,'#3E7D5A');F(A,0,railY-1,W,1,'#2E5E42');F(A,0,railY,W,1,'#4E9A6E');
 pfloor(A,0,fy,W,H-fy,'#9A7A52');
 F(A,0,0,W,7,'#8E2424');F(A,0,0,W,1,'#B84A4A');F(A,0,6,W,1,'#5E1414');for(let sx=3;sx<W-2;sx+=8)F(A,sx,2,4,3,'#E8C14A');
 F(A,14,7,1,3,'#6a5040');F(A,11,10,7,5,'#E0554A');F(A,11,12,7,1,'#E8C14A');glow(A,14,12,'#E85D4A');
 box(A,24,9,34,12,'#204030');for(let r=0;r<3;r++)F(A,27,11+r*3,20,1,['#F4F0E4','#E8C14A','#DcE8C0'][r]);F(A,50,11,5,7,'#C8A0D0');F(A,51,10,3,1,'#3A2A24');glow(A,52,14,'#E8C0E8');
 const cw=Math.round(W*0.36);box(A,4,fy-11,cw,11,'#8A6E48');F(A,4,fy-11,cw,1,'#A8845C');
 F(A,8,fy-19,7,8,'#B8BCC0');F(A,9,fy-12,5,1,'#8A8E92');F(A,11,fy-11,3,2,'#6A6E72');F(A,8,fy-19,7,2,'#D8DCE0');
 [18,24,30].forEach((dx,i)=>{F(A,dx,fy-17,4,6,['#C8A0D0','#E8C060','#A8D0B0'][i]);F(A,dx,fy-17,4,1,'#F4F0E4',0.5);F(A,dx,fy-11,4,1,'#6A5A48');});
 F(A,cw-8,fy-14,3,3,'#F4F0E4');F(A,cw-8,fy-17,3,3,'#F4F0E4');
 F(A,cw-4,fy-14,3,2,'#2A2E38');
 person(A,10,fy-11,'#C0392B');
 const bx=cw+8;box(A,bx,fy-6,W-bx-4,2,'#6A4A30');
 for(let sx=bx+3,i=0;sx+6<W-4;sx+=17,i++){F(A,sx+1,fy-3,3,3,'#5A4632');person(A,sx,fy-3,['#8A94A8','#6E5A4A','#3F8C84'][i%3]);boba(A,sx+6,fy-9,['#C8A0D0','#E8C060','#D0A080'][i%3]);}
 F(A,W-6,fy-12,1,12,'#4E7A3E');F(A,W-8,fy-14,3,2,'#5AA85A');F(A,W-5,fy-16,3,2,'#5AA85A');box(A,W-8,fy-4,5,4,'#8C5A3A');
}
function parlor(A,W,H){const fy=38;wtex(A,0,7,W,fy-7,'#F0E0EA','flat');pfloor(A,0,fy,W,H-fy,'#E8B7C8',true);band(A,W,'#E07AA6','#FFFFFF');
 F(A,Math.round(W*0.5)-2,9,4,4,'#F4E4B0');F(A,Math.round(W*0.5)-1,13,2,3,'#E8A050');glow(A,Math.round(W*0.5),11,'#FFF0C0');
 for(let vx=0;vx<W;vx+=6)F(A,vx,7,3,3,vx%12?'#E07AA6':'#FFFFFF');
 box(A,5,fy-13,30,13,'#F6F4F6');F(A,5,fy-13,30,3,'#BCD8E8');for(let k=0;k<5;k++)F(A,8+k*5,fy-11,4,4,['#E88AB0','#F4E4B0','#8C5A3A','#A0D8C0','#F0A0A0'][k]);
 F(A,7,fy-17,1,4,'#E8B870');F(A,7,fy-19,1,2,'#F4C0D0');F(A,11,fy-16,1,3,'#E8B870');F(A,11,fy-18,1,2,'#F0E0B0');
 const cw=Math.round(W*0.32);box(A,cw+8,fy-6,W-cw-14,2,'#C8DCE8');for(let sx=cw+12,i=0;sx+6<W-16;sx+=18,i++){F(A,sx+1,fy-5,3,5,'#C87A8E');F(A,sx,fy-5,5,1,'#D88AA0');person(A,sx,fy-5,['#E88AB0','#8FB6D8','#F0C040'][i%3]);}
 F(A,W-14,fy-11,3,11,'#D87A9A');box(A,W-11,fy-6,8,2,'#E8A0B8');person(A,W-9,fy,'#8FB6D8');
}
function cafe(A,W,H){const fy=38;wtex(A,0,7,W,fy-7,'#E8DCC6','flat');pfloor(A,0,fy,W,H-fy,'#8A6A48');band(A,W,'#6E4A32','#E8DCC8');
 box(A,Math.round(W*0.4),9,26,11,'#26302A');for(let r=0;r<3;r++)F(A,Math.round(W*0.4)+3,12+r*3,18,1,['#DcE8C0','#F4F0E4','#E8C0A0'][r]);
 F(A,Math.round(W*0.72),8,1,3,'#3A2E28');box(A,Math.round(W*0.72)-6,11,13,5,'#5A4632');F(A,Math.round(W*0.72)-4,12,9,3,'#E8DCC8');
 pendant(A,Math.round(W*0.24),'#6E4A32');
 const cw=Math.round(W*0.34);box(A,4,fy-9,cw,9,'#5A4632');F(A,4,fy-9,cw,1,'#7A6248');
 F(A,8,fy-14,7,5,'#9AA0A8');F(A,9,fy-13,2,3,'#5A5E66');F(A,10,fy-16,1,2,'#F4F0E4',0.6);glow(A,10,fy-15,'#F0F4F8');
 F(A,17,fy-13,4,4,'#3A3E44');box(A,cw-14,fy-13,12,4,'#EEE8DA');for(let k=0;k<3;k++)F(A,cw-12+k*4,fy-13,2,2,['#C8905A','#E8C060','#B06040'][k]);
 person(A,10,fy-9,'#F4F0EC');
 const bx=cw+8;box(A,bx,fy-6,Math.round(W*0.3),2,'#8C6E48');for(let sx=bx+2,i=0;sx+6<bx+W*0.3;sx+=15,i++){F(A,sx+1,fy-3,3,3,'#5A4632');F(A,sx,fy-9,3,2,'#F4F0E4');person(A,sx,fy-3,['#6E5A4A','#8A94A8'][i%2]);}
 box(A,W-24,fy-9,10,9,'#7C5A4A');F(A,W-24,fy-11,10,3,'#8C6A5A');person(A,W-22,fy-1,'#3F8C84');box(A,W-13,fy-5,8,2,'#6B4A2B');F(A,W-11,fy-8,4,2,'#2A2E38');
}
function rest(A,W,H,t){const fy=38,railY=24,L=RL[t];twall(A,0,0,W,fy,L.wall);wainscot(A,0,fy,W,railY,L.wall);F(A,0,0,W,2,shd(L.wall,-22));F(A,0,2,W,1,shd(L.wall,16));pfloor(A,0,fy,W,H-fy,L.floor);
  if(t==='french'){const cxx=Math.round(W/2);F(A,cxx-1,2,2,4,'#6a5040');F(A,cxx-7,6,14,2,'#C9A24B');[-6,-2,2,6].forEach(o=>{F(A,cxx+o,8,1,2,'#F8E2B4');glow(A,cxx+o,9,'#F8E2B4');});[Math.round(W*0.2),Math.round(W*0.8)].forEach(px=>{F(A,px,2,1,4,'#6a5040');F(A,px-2,6,5,2,'#C9A24B');F(A,px-1,8,3,2,'#F8E2B4');glow(A,px,9,'#F8E2B4');});artF(A,16,7,16,11,'#3E5A6E');artF(A,W-32,7,16,11,'#6E4A3A');box(A,Math.round(W*0.37),6,20,13,'#C9A24B');F(A,Math.round(W*0.37)+2,8,16,9,'#8FB6C8',0.7);sconce(A,46,13);sconce(A,W-48,13);box(A,6,railY+1,12,fy-railY-1,'#3A2418');for(let r=0;r<3;r++)for(let k=0;k<3;k++)F(A,8+k*3,railY+3+r*4,2,3,['#7A2A2A','#3A5A3A','#6A4A2A'][(k+r)%3]);for(let tx=28;tx+20<W-6;tx+=34){F(A,tx-5,fy-13,3,13,'#5A3A2A');F(A,tx+18,fy-13,3,13,'#5A3A2A');F(A,tx,fy-8,16,8,'#F0ECE0');F(A,tx,fy-8,16,1,'#FFFFFF');F(A,tx,fy-3,16,3,'#DcD6C6');F(A,tx+7,fy-12,1,4,'#E8C14A');glow(A,tx+7,fy-12,'#F8E2B4');F(A,tx+3,fy-10,1,2,'#C0D8E8');F(A,tx+12,fy-10,1,2,'#C0D8E8');person(A,tx-5,fy-1,'#8A94A8');person(A,tx+16,fy-1,'#B0857A');}}
  else if(t==='pub'){const barW=Math.round(W*0.3);box(A,5,6,barW,railY-6,'#2A1C10');for(let r=0;r<3;r++)for(let bx=8;bx<barW;bx+=4)F(A,bx,8+r*5,2,4,['#4A7A4A','#B08A3E','#8C3A32','#3A5A7A'][(bx+r)%4]);box(A,4,fy-9,barW+2,6,'#4A3220');F(A,4,fy-9,barW+2,1,'#6A4A30');[9,14,19].forEach(fx=>F(A,fx,fy-12,1,3,'#D8B05A'));for(let sx=barW+8;sx<barW+40;sx+=10){F(A,sx,fy-4,2,4,'#3A2A1A');person(A,sx-2,fy,'#6E5A4A');}[Math.round(W*0.5),Math.round(W*0.78)].forEach(fx=>{F(A,fx-1,6,2,3,'#2A1E14');F(A,fx-2,9,4,3,'#F8E2B4');glow(A,fx,10,'#FFE69A');});artF(A,Math.round(W*0.62),8,14,9,'#2A4A2A');for(let tx=barW+44;tx+14<W-6;tx+=32){F(A,tx-3,fy-10,3,10,'#3A2A1A');F(A,tx+13,fy-10,3,10,'#3A2A1A');box(A,tx,fy-6,13,2,'#6A4A30');F(A,tx+4,fy-9,3,3,'#B08A3E');F(A,tx+4,fy-9,3,1,'#D8B860');person(A,tx-3,fy,'#6E5A4A');person(A,tx+13,fy,'#8A6A5A');}}
  else if(t==='chinese'){for(let px=0;px<W;px+=14)F(A,px,4,1,railY-4,'#7A2A2A',0.5);[Math.round(W*0.28),Math.round(W*0.72)].forEach(fx=>{F(A,fx,2,1,4,'#6a5040');F(A,fx-5,6,10,9,'#E0554A');F(A,fx-5,10,10,1,'#E8C14A');F(A,fx-5,6,10,1,'#F08070');glow(A,fx,10,'#E85D4A');F(A,fx-1,15,2,3,'#C8A040');});box(A,Math.round(W*0.44),7,26,12,'#7A2A2A');for(let k=0;k<6;k++)F(A,Math.round(W*0.44)+3+k*4,9,2,8,'#E8C14A');for(let tx=16;tx+24<W-6;tx+=46){F(A,tx+10,fy-1,3,1,'#000000',0.2);F(A,tx,fy-7,22,5,'#E8D8C0');F(A,tx,fy-7,22,1,'#FFF6E8');F(A,tx+8,fy-9,6,3,'#E8C14A');F(A,tx+10,fy-10,2,2,'#C0392B');person(A,tx-4,fy,'#C0392B');person(A,tx+22,fy,'#D8B05A');person(A,tx+9,fy,'#8A94A8');}}
  else if(t==='sushi'){F(A,6,7,W-12,3,'#6A4A30');for(let k=0;k<7;k++)F(A,10+k*((W-24)/7),8,3,2,['#3A5A3A','#7A2A2A','#B08A3E'][k%3]);box(A,6,fy-11,W-14,5,'#E8DCC8');F(A,6,fy-13,W-14,2,'#BCD8E8');for(let px=12;px+3<W-12;px+=12){F(A,px,fy-12,4,1,(px%2)?'#F4F0E4':'#E88AB0');F(A,px,fy-15,3,2,['#E88AB0','#3A5A7A','#C0392B'][px%3]);}const chef=Math.round(W*0.5);person(A,chef,fy-11,'#F4F0EC');F(A,chef-1,fy-21,6,2,'#FFFFFF');for(let tx=14;tx+6<W-12;tx+=19){F(A,tx,fy-3,3,3,'#5A4632');person(A,tx-1,fy,'#5A6E8C');}}
  else{box(A,6,8,22,railY-6,'#1E1614');F(A,8,15,18,3,'#E8862A');F(A,8,13,18,2,'#3A2A1A');glow(A,17,16,'#E8862A');F(A,6,7,22,2,'#2A2018');artF(A,Math.round(W*0.5),7,18,10,'#3A241A');for(let tx=36;tx+20<W-6;tx+=34){F(A,tx-1,fy-13,4,13,'#4A2E22');F(A,tx-1,fy-13,4,1,'#5E3E2E');F(A,tx+16,fy-13,4,13,'#4A2E22');F(A,tx+16,fy-13,4,1,'#5E3E2E');box(A,tx+3,fy-6,13,2,'#6A4A32');F(A,tx+7,fy-8,3,2,'#F4F0E4');F(A,tx+7,fy-10,2,2,'#E8C14A');glow(A,tx+8,fy-10,'#F8E2B4');person(A,tx+2,fy,'#8A5A4A');person(A,tx+12,fy,'#B0857A');}}
}
function cinema(A,W,H){const fy=H-5;
  twall(A,0,0,W,H,'#241026');
  for(let bx=3,i=0;bx<W-2;bx+=7,i++)F(A,bx,2,3,3,i%2?'#FFD24A':'#FF6B6B');
  F(A,0,6,W,1,'#3A1A3E');
  const sx=Math.round(W*0.24),sw=Math.round(W*0.52),syt=10,syb=44;
  F(A,sx-6,syt-2,sw+12,syb-syt+4,'#5A1420');
  for(let cxN=sx-6;cxN<sx+sw+6;cxN+=5)F(A,cxN,syt-2,2,syb-syt+4,'#7A1E2E');
  F(A,sx-6,syt-3,sw+12,3,'#8A2436');F(A,sx-6,syt-3,sw+12,1,'#A83C4A');
  box(A,sx,syt,sw,syb-syt,'#0A0E1A');F(A,sx+1,syt+1,sw-2,10,'#8FB6E0');F(A,sx+1,syt+11,sw-2,8,'#B8C8A0');F(A,sx+1,syt+19,sw-2,syb-syt-20,'#5A7A4A');
  F(A,sx+Math.round(sw*0.6),syt+3,4,4,'#FFF0B0');glow(A,sx+Math.round(sw*0.62),syt+5,'#FFF0C0');
  for(let k=0;k<3;k++)F(A,sx+8+k*10,syt+syb-syt-4,6,1,'#1A1D24');
  glow(A,sx+sw/2,syt+(syb-syt)/2,'#9FC0E0');
  F(A,Math.round(W*0.5)-1,syb,2,fy-syb-16,'#BFE0F4',0.05);F(A,Math.round(W*0.5)-6,fy-18,12,10,'#BFE0F4',0.04);
  F(A,0,46,W,2,'#3A1A2E');F(A,0,46,W,1,'#5A2A3E');for(let px=6;px<W;px+=10)F(A,px,44,1,4,'#4A2038');
  for(let sxn=6;sxn<W-4;sxn+=7){F(A,sxn,40,5,4,'#2A1428');F(A,sxn,40,5,1,'#3E1E38');if((sxn*7)%5!==0){F(A,sxn+1,37,3,3,'#3A2E28');F(A,sxn+1,37,3,1,'#5A4438');}}
  for(let r=0;r<3;r++){const ry=fy-4-r*6;for(let sxn=5;sxn<W-4;sxn+=7){F(A,sxn,ry,5,5,'#22101F');F(A,sxn,ry,5,1,'#341830');if((sxn*3+r)%4!==0){F(A,sxn+1,ry-3,3,3,'#3A2E28');F(A,sxn+1,ry-3,3,1,'#5A4438');}}}
  for(let px=10;px<W;px+=30)F(A,px,fy-1,2,1,'#E8C14A');
  exitSign(A,4,48);exitSign(A,W-14,48);exitSign(A,4,fy-14);exitSign(A,W-14,fy-14);
}
function party(A,W,H){const fy=H-6,railY=52;
  twall(A,0,0,W,fy,'#3A2A44');F(A,0,railY,W,fy-railY,'#4A2A3A');
  F(A,0,0,W,2,'#241830');F(A,0,2,W,1,'#5A4468');
  for(let wx=10;wx+22<W;wx+=44){box(A,wx,8,22,railY-14,'#1A2440');for(let i=0;i<3;i++)F(A,wx+2,10+i*Math.round((railY-18)/3),18,Math.round((railY-20)/3),['#2A3A6A','#20305A','#18264A'][i]);for(let dx=wx+3;dx<wx+20;dx+=5)F(A,dx,10,1,railY-16,'#F3D08A',0.5);F(A,wx-2,7,4,railY-12,'#7A3A5A');F(A,wx+20,7,4,railY-12,'#7A3A5A');F(A,wx-2,6,26,2,'#8A4A6A');}
  [Math.round(W*0.3),Math.round(W*0.7)].forEach(cxN=>{F(A,cxN-1,2,2,5,'#C9A24B');F(A,cxN-8,7,16,2,'#C9A24B');[-6,-2,2,6].forEach(o=>{F(A,cxN+o,9,1,2,'#F8E2B4');glow(A,cxN+o,10,'#F8E2B4');});glow(A,cxN,10,'#FFE69A');});
  for(let bx=0;bx<W;bx+=10)F(A,bx,railY-3,5,3,['#E07A9A','#7FB0E8','#E8C14A','#8FD0A0'][(bx/10)%4|0]);
  F(A,0,railY-4,W,1,'#C9A24B');
  const stW=Math.round(W*0.24);box(A,4,fy-16,stW,16,'#2A1F3A');F(A,4,fy-16,stW,1,'#4A3A5A');
  F(A,Math.round(stW/2),railY+2,1,4,'#8A8A92');F(A,Math.round(stW/2)-2,railY+6,5,5,'#CDD6E6');F(A,Math.round(stW/2)-1,railY+7,3,3,'#FFFFFF',0.6);
  ['#E85D5D','#5db4e8','#6bd47a'].forEach((c,i)=>{F(A,8+i*(stW/3),railY+8,3,fy-16-(railY+8),c,0.28);});
  person(A,Math.round(stW/2)-3,fy-16,'#2A2E38');F(A,Math.round(stW/2)-4,fy-24,9,3,'#3A3E4A');
  const dfx=stW+8,dfw=Math.round(W*0.3);for(let px=dfx;px<dfx+dfw;px+=6)F(A,px+((((px-dfx)/6)|0)%2?3:0),fy-1,3,1,'#5A4A6E');
  const dcol=['#E07A9A','#7FB0E8','#E8C14A','#6bd47a','#D8B05A'];for(let dx=dfx+2,i=0;dx+6<dfx+dfw;dx+=11,i++)person(A,dx,fy,dcol[i%dcol.length]);
  const tx=dfx+dfw+10,tw=W-tx-6;F(A,tx,fy,tw,1,'#000000',0.2);box(A,tx,fy-9,tw,4,'#C9A24B');F(A,tx,fy-9,tw,4,'#F0ECE0');F(A,tx,fy-9,tw,1,'#FFFFFF');F(A,tx,fy-5,tw,1,'#DcD6C6');
  for(let px=tx+5;px<tx+tw-3;px+=12){F(A,px,fy-11,3,2,'#E07A9A');F(A,px+1,fy-13,1,2,'#4A7A4A');}
  for(let px=tx+2;px<tx+tw-2;px+=6)F(A,px,fy-8,2,1,'#FFFFFF');
  for(let sx=tx+2,i=0;sx+6<tx+tw;sx+=13,i++){F(A,sx,fy-14,4,5,'#5A3A5A');person(A,sx,fy,['#8A94A8','#B0857A','#D8B05A'][i%3]);}
}
const T=figma.createText();T.fontName={family:'Inter',style:'Bold'};T.fontSize=24;T.characters="Food & Entertainment";T.fills=[{type:'SOLID',color:hex('#F4F0E4')}];root.appendChild(T);T.x=40;T.y=28;
let cx=40,cy=70,rowH=0;
function ph(txt){const S=figma.createText();S.fontName={family:'Inter',style:'Bold'};S.fontSize=18;S.characters=txt;S.fills=[{type:'SOLID',color:hex('#F3D08A')}];root.appendChild(S);S.x=40;S.y=cy;cy+=30;}
function place(label,cap,tiles,floors,fn){const PS=3,W=tiles*11*PS,H=floors*44*PS;if(cx+W>1240){cx=40;cy+=rowH+70;rowH=0;}render("art:"+label,cx,cy,tiles,floors,fn);annotate(label,cap,cx,cy+H+8,W);cx+=W+26;rowH=Math.max(rowH,H);}
ph("Fast Food  (5 canon subtypes, each a DIFFERENT room, not a recolor)");
place("Fast Food: Hamburger","A service counter with grill, soda machine and a cook, and a dining area of round pedestal two-tops with trays and seated couples (now a clearly bigger, wider figure). Checker floor.",16,1,burger);
place("Fast Food: Japanese Soba","A full-width indigo noren, a long noodle bar with stools, steaming bowls, and a chef at a broth pot. Diners seated along the counter.",16,1,soba);
place("Fast Food: Chinese Cafe","A casual TEA / BOBA counter: stainless tea urn, colored boba dispensers, a drinks menu, a window stool bar of patrons holding boba, jade wainscot and a bamboo plant. Distinct from the Chinese banquet restaurant.",16,1,teaCafe);
place("Fast Food: Ice Cream","A PARLOR: a chrome display freezer with colored tubs and a cone rack, a soda-fountain counter with tall stools and kids, and a pink booth. Scalloped valance.",16,1,parlor);
place("Fast Food: Coffee Shop","A CAFE: an espresso bar with machine, grinder and a pastry case tended by a barista, a chalkboard menu, a window bench of patrons, and a lounge armchair with a laptop.",16,1,cafe);
cx=40;cy+=rowH+76;rowH=0;
ph("Restaurants  (5 canon subtypes, each a different dining room)");
place("Restaurant: French","Chandelier, pendants and sconces, framed art and a gilt mirror, a wine rack, dressed white-cloth tables with candles, and seated diners on patterned carpet.",24,1,(A,W,H)=>rest(A,W,H,'french'));
place("Restaurant: English Pub","A back bar with a lit bottle wall, brass taps and stools with seated regulars, hanging pub lamps, a framed print, wood tables with pints.",24,1,(A,W,H)=>rest(A,W,H,'pub'));
place("Restaurant: Chinese","Red papered wall, paired glowing lanterns and a carved screen, round banquet tables with a gold lazy-susan and parties of seated diners.",24,1,(A,W,H)=>rest(A,W,H,'chinese'));
place("Restaurant: Sushi Bar","A long light-wood sushi counter with a glass case, colored nigiri plates, a chef in whites, a bottle shelf, seated diners along the bar.",24,1,(A,W,H)=>rest(A,W,H,'sushi'));
place("Restaurant: Steak House","Dark leather room, a hooded grill glowing orange, framed art, high-back leather booths with candlelit tables and seated diners.",24,1,(A,W,H)=>rest(A,W,H,'steak'));
cx=40;cy+=rowH+76;rowH=0;
ph("Entertainment  (two-floor venues)");
place("Cinema  ·  31 tiles x 2 floors","A grand auditorium: marquee bulbs, a curtain-framed screen with a projector beam, a balcony rail, raked rows of seat-heads with an audience, aisle lights, and green EXIT signs on BOTH floors (canon).",31,2,cinema);
place("Party Hall  ·  24 tiles x 2 floors","Grand function hall: chandeliers and a string-light banner, tall draped arched windows, a stage with mirror ball, colored spotlights and a DJ, a checker dance floor of dancers, and a long banquet table with seated guests.",24,2,party);
root.resize(1280, cy+rowH+100);
return { rebuilt:"page 3 with bigger 15px occupants" };
