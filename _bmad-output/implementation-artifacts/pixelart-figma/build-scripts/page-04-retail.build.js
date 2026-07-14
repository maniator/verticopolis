
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const root=await figma.getNodeByIdAsync("57:3");
for(const c of [...root.children]) c.remove();
await figma.loadFontAsync({family:"Inter",style:"Bold"});await figma.loadFontAsync({family:"Inter",style:"Semi Bold"});await figma.loadFontAsync({family:"Inter",style:"Regular"});
function shd(h,a){const n=parseInt(h.slice(1),16);const c=v=>Math.max(0,Math.min(255,v+a));const r=c((n>>16)&255),g=c((n>>8)&255),b=c(n&255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
function box(A,x,y,w,h,b){F(A,x,y+h,w,1,'#000000',0.18);F(A,x,y,w,h,b);F(A,x,y,w,1,shd(b,22));F(A,x,y,1,h,shd(b,12));F(A,x+w-1,y,1,h,shd(b,-16));F(A,x,y+h-1,w,1,shd(b,-22));}
function glow(A,cx,cy,c){[[4,0.1],[3,0.16],[2,0.3],[1,0.6]].forEach(s=>F(A,cx-s[0],cy-s[0],s[0]*2,s[0]*2,c,s[1]));}
function person(A,x,f,sh){const head=5,body=10;F(A,x-1,f,7,1,'#000000',0.24);F(A,x,f-body,6,body,sh);F(A,x,f-body,1,body,shd(sh,-26));F(A,x+5,f-body,1,body,shd(sh,16));F(A,x+1,f-body+2,4,1,shd(sh,-14));F(A,x+1,f-body-head,4,head,'#E8C9A0');F(A,x+1,f-body-head,4,1,'#3A2E28');F(A,x+3,f-body-head+2,1,1,'#F0D8B8');}
function wtex(A,x,y,w,h,b){F(A,x,y,w,h,b);F(A,x,y,w,Math.round(h*0.4),shd(b,6));for(let py=y+4;py<y+h;py+=6)F(A,x,py,w,1,shd(b,-6),0.4);}
function pfloor(A,x,fy,w,h,b){F(A,x,fy,w,h,b);F(A,x,fy,w,1,shd(b,18));F(A,x,fy+1,w,1,shd(b,-8));F(A,x,fy+h-1,w,1,shd(b,-24));for(let px=x+7;px<x+w;px+=11)F(A,px,fy+1,1,h-2,shd(b,-14));}
function awning(A,W,color){for(let sx=0;sx<W;sx+=10){F(A,sx,0,5,6,'#FFFFFF');F(A,sx+5,0,5,6,color);}F(A,0,0,W,1,shd(color,20));for(let sx=0;sx<W;sx+=4)F(A,sx,6,2,1,sx%8?color:'#FFFFFF');F(A,0,7,W,1,'#5A4038');}
function signboard(A,W,color,railY){F(A,4,railY-6,W-8,5,shd(color,-30));F(A,5,railY-5,W-10,3,color);glow(A,W/2,railY-4,shd(color,40));}
function shopBase(A,W,wall,awnC,railY){wtex(A,8,railY,W-8,38-railY,wall);pfloor(A,0,38,W,6,shd(wall,-40));awning(A,W,awnC);signboard(A,W,awnC,railY);}
function render(name,gx,gy,tiles,fn){const PS=3,W=tiles*11,H=44,A=[];fn(A,W,H);const sc=figma.createFrame();sc.name=name;sc.resize(W*PS,H*PS);sc.clipsContent=true;sc.cornerRadius=3;sc.fills=[{type:'SOLID',color:hex('#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.45},offset:{x:0,y:2},radius:7,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});}
function annotate(name,cap,x,y,w){const t=figma.createText();t.fontName={family:'Inter',style:'Semi Bold'};t.fontSize=13;t.characters=name;t.fills=[{type:'SOLID',color:hex('#F4F0E4')}];root.appendChild(t);t.x=x;t.y=y;const c=figma.createText();c.fontName={family:'Inter',style:'Regular'};c.fontSize=11;c.characters=cap;c.fills=[{type:'SOLID',color:hex('#9AA4B4')}];c.textAutoResize='HEIGHT';root.appendChild(c);c.resize(Math.max(w||280,210),44);c.x=x;c.y=y+16;}
function mens(A,W,H){const fy=38,railY=14;shopBase(A,W,'#ECEEF2','#5A6E8C',railY);
  for(const ry of [railY+2,railY+11]){F(A,10,ry,Math.round(W*0.5),1,'#8A8A92');for(let gx=13,k=0;gx+3<10+W*0.5;gx+=6,k++){F(A,gx,ry+1,3,7,['#3E4654','#5A6E8C','#6E5A4A','#2A3A4A'][k%4]);F(A,gx,ry+1,3,1,'#F4F0E4',0.2);}}
  const fx=Math.round(W*0.58);box(A,fx,fy-4,18,4,'#8C6E50');for(let k=0;k<3;k++){F(A,fx+2+k*6,fy-8,4,4,['#5A6E8C','#F4F0E4','#6E5A4A'][k]);}
  const mx=W-18;F(A,mx,fy-2,7,2,'#C8C8C8');F(A,mx+1,fy-13,5,11,'#3E4654');F(A,mx+2,fy-16,3,3,'#E8C9A0');box(A,W-9,railY,4,fy-railY,'#B8C8D4');
  person(A,fx-7,fy,'#6E5A4A');}
function pets(A,W,H){const fy=38,railY=14;shopBase(A,W,'#F0EEE2','#8C6E50',railY);
  for(let r=0;r<2;r++)for(let cN=0;cN<3;cN++){const cx=10+cN*12,cy=railY+1+r*10;box(A,cx,cy,10,9,'#B8A890');for(let bx=cx+1;bx<cx+10;bx+=2)F(A,bx,cy+1,1,7,'#8A7A64');F(A,cx+3,cy+4,4,3,['#C99A6E','#E8C14A','#F4F0E4','#8C5A3A','#D0B090','#A0A0A0'][(r*3+cN)]||'#C99A6E');}
  const ax=Math.round(W*0.5);box(A,ax,fy-11,20,10,'#2A4A64');F(A,ax+1,fy-10,18,8,'#4FA0C8');F(A,ax+3,fy-7,3,1,'#E88F4A');F(A,ax+9,fy-8,3,1,'#F4E4A0');F(A,ax+14,fy-6,3,1,'#E88F4A');for(let wv=ax+1;wv<ax+19;wv+=3)F(A,wv,fy-10,1,1,'#8FD0E8',0.6);
  box(A,W-16,fy-8,12,8,'#8A6E50');for(let k=0;k<3;k++)F(A,W-14+k*4,fy-6,3,4,['#C86A3A','#E8C14A','#5AA85A'][k]);
  person(A,ax-8,fy,'#3F8C84');}
function florist(A,W,H){const fy=38,railY=14;shopBase(A,W,'#F2F5EC','#E88AB0',railY);
  F(A,W-16,railY+1,10,3,'#4E7A3E');F(A,W-14,railY+4,6,3,'#3E6A2E');
  for(const g of [[railY+3,10,Math.round(W*0.5)],[railY+11,14,Math.round(W*0.4)]]){const ty=g[0],tx=g[1],tw=g[2];F(A,tx,ty+4,tw,1,'#A98A6A');for(let gx=tx+2,k=0;gx+3<tx+tw;gx+=6,k++){F(A,gx+1,ty+1,1,3,'#4A7A4A');F(A,gx,ty-1,3,3,['#e85d5d','#E88AB0','#e8c14a','#F4F0E4','#C87FE0','#F0A0C0'][k%6]);}}
  for(let bx=Math.round(W*0.56),k=0;k<4;bx+=9,k++){box(A,bx,fy-6,7,6,'#8A8A92');F(A,bx+1,fy-8,5,2,['#E85D5D','#E8C14A','#C87FE0','#F0A0C0'][k]);F(A,bx+3,fy-10,1,3,'#4A7A4A');}
  box(A,10,fy-6,16,6,'#A9743C');F(A,12,fy-8,4,2,'#F4E4C0');
  person(A,28,fy,'#5AA85A');}
function books(A,W,H){const fy=38,railY=14;shopBase(A,W,'#F0EAD8','#3E4654',railY);
  for(const cx of [10,Math.round(W*0.34),Math.round(W*0.58)]){const cw=Math.min(20,Math.round(W*0.22));box(A,cx,railY,cw,fy-railY-1,'#6A5240');for(let r=0;r<4;r++)for(let bx=cx+2,k=0;bx+2<cx+cw-1;bx+=3,k++)F(A,bx,railY+2+r*6,2,5,['#8C3A32','#3E5A8C','#4A7A4A','#B08A3E','#5A4A6E','#7A2A2A'][(k+r)%6]);}
  const dx=W-24;box(A,dx,fy-6,16,3,'#8C6E50');F(A,dx+2,fy-8,4,2,'#F4F0E4');F(A,dx+7,fy-9,1,3,'#7A6A50');F(A,dx+5,fy-11,5,3,'#F8E2B4');glow(A,dx+7,fy-9,'#F8E2B4');
  F(A,W-6,railY,1,fy-railY,'#8A6A4A');for(let ly=railY+3;ly<fy;ly+=4)F(A,W-8,ly,4,1,'#8A6A4A');
  person(A,dx-8,fy,'#3E5A8C');}
function drug(A,W,H){const fy=38,railY=14;shopBase(A,W,'#F4F7F2','#3A8A4A',railY);
  F(A,W-16,railY+1,10,3,'#FFFFFF');F(A,W-12,railY-1,2,7,'#3A8A4A');F(A,W-15,railY+2,8,2,'#3A8A4A');
  const cw=Math.round(W*0.34);box(A,8,fy-8,cw,8,'#F0F0EC');F(A,8,fy-8,cw,1,'#FFFFFF');person(A,8+Math.round(cw/2),fy-8,'#F4F0EC');F(A,14,fy-12,6,4,'#DcE8DC');
  for(let ay=railY+2;ay<fy-10;ay+=8){F(A,cw+14,ay,Math.round(W*0.4),1,'#A98A6A');for(let gx=cw+16,k=0;gx+3<cw+14+W*0.4;gx+=6,k++)F(A,gx,ay-4,4,4,['#FFFFFF','#9FD0C8','#5db4e8','#E8E4D0','#F4A0A0'][k%5]);}
  box(A,W-14,fy-11,10,11,'#DCE8EC');F(A,W-13,fy-10,8,4,'#BFE0E8');F(A,W-11,fy-6,4,1,'#5db4e8');
  person(A,cw+8,fy,'#5A6E8C');}
function boutique(A,W,H){const fy=38,railY=14;shopBase(A,W,'#F5EFF7','#9A5FB0',railY);
  F(A,Math.round(W/2)-1,railY,2,3,'#C9A24B');F(A,Math.round(W/2)-3,railY+3,5,2,'#E8C860');glow(A,Math.round(W/2),railY+3,'#F8E2B4');
  const dx=Math.round(W*0.2);F(A,dx,fy-4,6,2,'#C8C8C8');F(A,dx+1,fy-16,4,12,'#C8A8E0');F(A,dx+1,fy-16,4,1,'#E8D0F0');F(A,dx+2,fy-18,2,2,'#E8C9A0');glow(A,dx+3,fy-11,'#F0E0F8');
  F(A,Math.round(W*0.42),railY+3,Math.round(W*0.24),1,'#B8A0C8');for(let gx=Math.round(W*0.44),k=0;k<3;gx+=8,k++)F(A,gx,railY+4,4,8,['#E8B8CC','#C8A8E0','#F0E0B8'][k]);
  F(A,W-14,railY+2,5,fy-railY-3,'#D0E0EC');F(A,W-15,railY+1,7,1,'#B8A0C8');
  box(A,W-30,fy-4,12,4,'#7C5A6A');
  person(A,Math.round(W*0.34),fy,'#B07FC0');}
function electronics(A,W,H){const fy=38,railY=13;shopBase(A,W,'#3E4654','#2A2E38',railY);
  for(let r=0;r<2;r++)for(let cN=0;cN<Math.floor((W-16)/12);cN++){const sx=10+cN*12,sy=railY+1+r*10;box(A,sx,sy,10,9,'#15151C');F(A,sx+1,sy+1,8,6,['#4FA0C8','#8FB6FF','#5db4e8','#6bd47a','#E8C060','#F08080'][(r*3+cN)%6]);F(A,sx+1,sy+1,8,1,'#FFFFFF',0.3);glow(A,sx+5,sy+4,'#6FB0E0');}
  box(A,8,fy-6,W-16,4,'#2A2E38');F(A,8,fy-6,W-16,1,'#3E4654');for(let gx=14,k=0;gx+4<W-10;gx+=16,k++){F(A,gx,fy-9,5,3,['#4FA0C8','#8FB6FF','#6bd47a'][k%3]);F(A,gx+1,fy-10,3,1,'#FFFFFF',0.4);}
  person(A,W-16,fy,'#4FA0C8');}
function bank(A,W,H){const fy=38,railY=14;shopBase(A,W,'#EDE9E2','#D8B05A',railY);
  const vx=W-16;F(A,vx-2,fy-16,16,16,'#6A6E76');F(A,vx-2,fy-16,16,1,'#8A8E96');F(A,vx+5,fy-8,5,5,'#3A3E44');for(let a=0;a<8;a++){const ang=a*0.785;F(A,vx+7+Math.round(Math.cos(ang)*5),fy-6+Math.round(Math.sin(ang)*5),1,1,'#8A8E96');}
  const cw=Math.round(W*0.5);box(A,8,fy-9,cw,6,'#D8D4C8');F(A,8,fy-9,cw,1,'#EAE6DA');for(const wx of [14,14+Math.round(cw/2)]){F(A,wx,fy-15,7,6,'#6A5240');F(A,wx+1,fy-14,5,4,'#E8E4DA');person(A,wx,fy-9,'#3E4654');}
  F(A,cw+12,fy-8,1,8,'#B89040');F(A,cw+18,fy-8,1,8,'#B89040');F(A,cw+12,fy-8,7,1,'#C8A040');
  F(A,cw+8,railY+3,6,6,'#D8B05A');F(A,cw+10,railY+5,2,2,'#B89040');
  person(A,cw+16,fy,'#6E5A4A');}
function salon(A,W,H){const fy=38,railY=14;shopBase(A,W,'#F2ECF0','#B84848',railY);
  for(const sx of [12,Math.round(W*0.4)]){F(A,sx,railY+2,7,8,'#C8DCE8');F(A,sx-1,railY+1,9,1,'#B8A0B0');F(A,sx-1,railY+2,1,8,'#D8E4EC');
    F(A,sx+1,fy-8,5,5,'#3E4654');F(A,sx+2,fy-3,3,3,'#2A2E38');
    person(A,sx,fy-1,'#C8A0A8');
    person(A,sx+8,fy,'#B84848');}
  const px=W-9;F(A,px,railY,3,12,'#F4F0E4');for(let py=0;py<12;py+=4){F(A,px,railY+py,3,2,'#B84848');F(A,px,railY+py+2,3,2,'#4F6EC8');}
  box(A,W-22,railY+2,10,6,'#E8DCEC');for(let k=0;k<3;k++)F(A,W-20+k*3,railY+3,2,4,['#E88AB0','#F4E4A0','#8FB6D8'][k]);
  F(A,Math.round(W*0.66),fy-6,7,3,'#C8DCE8');F(A,Math.round(W*0.67),fy-3,5,3,'#8A8E96');}
function post(A,W,H){const fy=38,railY=14;shopBase(A,W,'#EFEDE4','#4F6EC8',railY);
  for(let r=0;r<3;r++)for(let cN=0;cN<6;cN++){const bx=10+cN*5,by=railY+1+r*5;F(A,bx,by,4,4,'#C8B890');F(A,bx,by,4,1,'#D8C8A0');F(A,bx+1,by+1,1,1,'#8A7A54');}
  const cw=Math.round(W*0.3);box(A,Math.round(W*0.42),fy-8,cw,8,'#D8D4C8');person(A,Math.round(W*0.42)+Math.round(cw/2),fy-8,'#4F6EC8');F(A,Math.round(W*0.42)+3,fy-11,4,3,'#8A8E96');
  const pxs=Math.round(W*0.42)+cw+4;F(A,pxs,fy-5,7,5,'#C8A87A');F(A,pxs+8,fy-5,5,5,'#B8986A');F(A,pxs+3,fy-9,6,4,'#C8A87A');for(const p of [[pxs,fy-5],[pxs+8,fy-5],[pxs+3,fy-9]])F(A,p[0]+1,p[1]+1,3,1,'#8A6A44');
  F(A,W-11,fy-9,6,9,'#4F6EC8');F(A,W-11,fy-9,6,1,'#6E8AD8');F(A,W-10,fy-7,4,1,'#2A3A6A');
  person(A,Math.round(W*0.4)-6,fy,'#6E5A4A');}
function sports(A,W,H){const fy=38,railY=14;shopBase(A,W,'#EEF2F0','#E88F4A',railY);
  F(A,12,railY+1,8,9,'#e85d5d');F(A,11,railY,10,2,'#C84A4A');F(A,10,railY+2,2,3,'#e85d5d');F(A,20,railY+2,2,3,'#e85d5d');F(A,15,railY+3,2,2,'#FFFFFF');
  box(A,26,fy-6,14,6,'#8A8A92');for(let k=0;k<3;k++)F(A,29+k*4,fy-8,3,3,['#E88F4A','#F4F0E4','#e8c14a'][k]);
  for(let rx=Math.round(W*0.42),k=0;k<5;rx+=3,k++)F(A,rx,fy-13,1,13,k%2?'#C8A87A':'#A8845C');
  for(let r=0;r<2;r++)for(let cN=0;cN<3;cN++)F(A,Math.round(W*0.56)+cN*7,railY+2+r*6,6,4,['#5db4e8','#e85d5d','#6bd47a','#e8c14a','#E88F4A','#4F6EC8'][(r*3+cN)]);
  const mx=W-12;F(A,mx,fy-2,6,2,'#C8C8C8');F(A,mx+1,fy-14,4,12,'#E88F4A');F(A,mx+2,fy-17,3,3,'#E8C9A0');
  person(A,26,fy,'#5db4e8');}
function generic(A,W,H){const fy=38,railY=14;shopBase(A,W,'#EFE9F5','#b58ad6',railY);
  for(let row=0;row<2;row++){const ry=railY+2+row*9;F(A,10,ry+4,W-20,1,'#A98A6A');for(let gx=13,k=0;gx+3<W-10;gx+=6,k++)F(A,gx,ry,4,4,['#e85d5d','#5db4e8','#6bd47a','#e8c14a','#b07fe0','#e88f4a'][(k+row)%6]);}
  person(A,W-14,fy,'#b07fe0');}
const T=figma.createText();T.fontName={family:'Inter',style:'Bold'};T.fontSize=24;T.characters="Retail Shops  (11 canon trades, each a different store)";T.fills=[{type:'SOLID',color:hex('#F4F0E4')}];root.appendChild(T);T.x=40;T.y=28;
const S=figma.createText();S.fontName={family:'Inter',style:'Regular'};S.fontSize=13;S.characters="Every shop keeps the striped awning and lit sign, but each trade furnishes a genuinely different interior, and its shopper or clerk is now the bigger room-occupant size. 12 tiles wide x 1 floor.";S.fills=[{type:'SOLID',color:hex('#AEB8C6')}];root.appendChild(S);S.x=40;S.y=60;
let cx=40,cy=92,rowH=0;
function place(label,cap,tiles,fn){const PS=3,W=tiles*11*PS,H=44*PS;if(cx+W>1240){cx=40;cy+=rowH+70;rowH=0;}render("art:"+label,cx,cy,tiles,fn);annotate(label,cap,cx,cy+H+8,W);cx+=W+26;rowH=Math.max(rowH,H);}
place("Shop: Men's Clothing","Navy awning. Two rails of hanging suits and shirts, a folded-shirt table, a suited mannequin, a tall fitting mirror, and a browsing customer.",12,mens);
place("Shop: Pet Store","Brown awning. A stack of critter cages, a glowing blue aquarium with fish, a pet-supply shelf, and a customer.",12,pets);
place("Shop: Flower Shop","Pink awning. Tiered flower stands of colorful blooms on green stems, floor buckets, a hanging fern, a wrap counter, a florist.",12,florist);
place("Shop: Book Store","Charcoal awning. Three tall bookcases of colored spines, a lit reading table, a rolling ladder, and a reader.",12,books);
place("Shop: Drug Store","Green cross. A dispensing counter with a white-coated pharmacist, aisles of medicine bottles, a chilled medicine fridge, and a customer.",12,drug);
place("Shop: Boutique","Plum awning, chic and sparse: a spotlit dress on a form, a short designer rail, a tall gilt mirror, a velvet bench, a small chandelier.",12,boutique);
place("Shop: Electronics","Dark front, a wall of glowing demo screens, a gadget counter of phones with blue accent light, and a clerk.",12,electronics);
place("Shop: Bank","Gold sign. A teller counter with divider windows and tellers, a big round vault door, a queue rope, a brass coin, a customer.",12,bank);
place("Shop: Hair Salon","Two styling stations (mirror + chair) with a stylist cutting a seated client, a red-white barber pole, a wash basin, and a product shelf.",12,salon);
place("Shop: Post Office","A wall of brass PO boxes, a service counter with a clerk and a scale, stacked parcels, a blue mail drop box, and a customer.",12,post);
place("Shop: Sports Gear","A jersey on the wall, a ball bin, a rack of bats and sticks, a shoe wall, and a gear mannequin. Energetic orange.",12,sports);
place("Shop: Generic (no subtype)","The legacy fallback for an unset subtype: two shelves of colorful goods and a shopkeeper. Lavender awning.",12,generic);
root.resize(1280, cy+rowH+96);
return { rebuilt:"page 4 retail with bigger occupants", tiles:12 };
