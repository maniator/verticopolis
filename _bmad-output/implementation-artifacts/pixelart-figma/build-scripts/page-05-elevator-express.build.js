
const hex=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const root=await figma.getNodeByIdAsync("62:3");
await figma.setCurrentPageAsync(root.parent);
await figma.loadFontAsync({family:"Inter",style:"Regular"});
const old=root.children.find(c=>c.name==="art:Express Elevator");const gx=old.x,gy=old.y;old.remove();
function shd(h,a){const n=parseInt(h.slice(1),16);const c=v=>Math.max(0,Math.min(255,v+a));const r=c((n>>16)&255),g=c((n>>8)&255),b=c(n&255);return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}
function F(A,x,y,w,h,c,o){A.push([Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)),c,o===undefined?1:o]);}
function glow(A,cx,cy,c){[[4,0.1],[3,0.16],[2,0.3],[1,0.6]].forEach(s=>F(A,cx-s[0],cy-s[0],s[0]*2,s[0]*2,c,s[1]));}
const DIG={1:[[0,1,0],[1,1,0],[0,1,0],[0,1,0],[1,1,1]],2:[[1,1,1],[0,0,1],[1,1,1],[1,0,0],[1,1,1]],3:[[1,1,1],[0,0,1],[1,1,1],[0,0,1],[1,1,1]]};
function digit(A,x,y,d,col){const p=DIG[d];if(!p)return;for(let r=0;r<5;r++)for(let c=0;c<3;c++)if(p[r][c])F(A,x+c,y+r,1,1,col);}
function pw(A,x,f,sh){const head=4,body=10,leg=4;F(A,x-1,f,7,1,'#000000',0.25);F(A,x+1,f-leg,2,leg,'#2A2E38');F(A,x+4,f-leg,2,leg,'#2A2E38');F(A,x,f-leg-body,6,body,sh);F(A,x,f-leg-body,1,body,shd(sh,-26));F(A,x+5,f-leg-body,1,body,shd(sh,16));F(A,x+1,f-leg-body-head,4,head,'#E8C9A0');F(A,x+1,f-leg-body-head,4,1,'#3A2E28');F(A,x+3,f-leg-body-head+1,1,1,'#F0D8B8');}
function render(name,gx,gy,tiles,floors,fn){const PS=3,W=tiles*11,H=floors*44,A=[];fn(A,W,H);const sc=figma.createFrame();sc.name=name;sc.resize(W*PS,H*PS);sc.clipsContent=true;sc.cornerRadius=3;sc.fills=[{type:'SOLID',color:hex('#0C1019')}];root.appendChild(sc);sc.x=gx;sc.y=gy;sc.effects=[{type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.45},offset:{x:0,y:2},radius:8,spread:0,visible:true,blendMode:'NORMAL'}];A.forEach(r=>{const rr=figma.createRectangle();rr.resize(r[2]*PS,r[3]*PS);sc.appendChild(rr);rr.x=r[0]*PS;rr.y=r[1]*PS;rr.fills=[{type:'SOLID',color:hex(r[4]),opacity:r[5]}];});}
function queue(A,x,dir,deckY,n){const cols=['#5A6E8C','#3F8C84','#6E5A4A','#D8B05A','#8A94A8','#9A5FB0'];for(let i=0;i<n;i++){let sh=cols[i%cols.length];if(i>=n-1&&n>=4)sh='#C24A3A';else if(i>=n-2&&n>=3)sh='#E8862A';pw(A,x+dir*i*7,deckY,sh);}}
function express(A,W,H){const shaftW=66,shaftX=Math.round((W-shaftW)/2),fH=44;
  // FULL-WIDTH floors + a hint of rooms, drawn FIRST so they sit BEHIND the glass and show through
  for(let f=0;f<3;f++){const fb=f*fH;const deckY=fb+fH-6;
    F(A,0,fb,W,fH,'#DAD1BA');F(A,0,fb,W,1,'#C6B999');F(A,0,fb+1,W,1,'#E4DCC6');
    // faint furniture behind (a couple desks) so there is something to see through to
    for(let dx=6;dx<W-6;dx+=26){F(A,dx,deckY-6,16,3,'#9C7E58');F(A,dx+3,deckY-11,6,5,'#3A3E48');}
    F(A,0,deckY,W,6,'#B2A688');F(A,0,deckY,W,1,'#C6BA9C');F(A,0,deckY+5,W,1,'#9A8E72');
    F(A,0,fb,W,1,'#8A8068',0.5);
  }
  // GLASS shaft: a low-alpha tint over the structure (you see the floors + desks through it) + faint reflections
  F(A,shaftX,0,shaftW,H,'#AECBDA',0.22);
  for(let rx=shaftX+6;rx<shaftX+shaftW;rx+=14)F(A,rx,0,2,H,'#FFFFFF',0.06); // vertical glass reflections
  // frame mullions + rails (structural, opaque)
  F(A,shaftX,0,1,H,'#2A2E36');F(A,shaftX+shaftW-1,0,1,H,'#2A2E36');
  F(A,shaftX+3,0,2,H,'#6A7480');F(A,shaftX+shaftW-5,0,2,H,'#6A7480');
  for(let f=1;f<3;f++)F(A,shaftX,f*fH,shaftW,1,'#3A4652',0.6); // floor mullion lines across glass
  F(A,shaftX+2,0,shaftW-4,5,'#3A3E44');F(A,shaftX+2,0,shaftW-4,1,'#4E545C'); // motor
  for(let f=0;f<3;f++){const fb=f*fH;const num=3-f;const stops=(num===1||num===3);if(stops)F(A,shaftX+2,fb+3,shaftW-4,1,'#FFFFFF',0.5);digit(A,shaftX+shaftW-9,fb+5,num,stops?'#22506E':'#6A7E8E');}
  // car at lobby floor 1 (bottom) with fill, OPAQUE (in front of glass)
  const carF=2,carFb=carF*fH,carY=carFb+5,carH=fH-9;
  F(A,shaftX+Math.round(shaftW/2)-3,5,1,carY-5,'#4A4A4A');F(A,shaftX+Math.round(shaftW/2)+2,5,1,carY-5,'#4A4A4A');
  F(A,shaftX+3,carY,shaftW-6,carH,'#3A4048');F(A,shaftX+3,carY,shaftW-6,1,'#5A6472');
  F(A,shaftX+5,carY+2,shaftW-10,carH-4,'#6B4A2B');F(A,shaftX+5,carY+2,shaftW-10,1,'#C9A24B');glow(A,shaftX+Math.round(shaftW/2),carY+5,'#F8E2B4');
  const pcol=['#5A6E8C','#6E5A4A','#D8B05A','#3F8C84','#8A94A8'];for(let i=0;i<5;i++)pw(A,shaftX+8+i*Math.round((shaftW-18)/5),carY+carH-2,pcol[i]);
  F(A,shaftX+Math.round(shaftW/2)-1,carFb-2,3,3,'#6bd47a');glow(A,shaftX+Math.round(shaftW/2),carFb-1,'#6bd47a');
  // queues (real sims) at lobby floors 3 and 1; floor 2 skipped
  queue(A,shaftX-9,-1,0*fH+fH-6,4);
  queue(A,shaftX-9,-1,2*fH+fH-6,1);
}
render("art:Express Elevator",gx,gy,16,3,express);
const cap=root.findOne(n=>n.type==="TEXT"&&n.characters.startsWith("See-through glass shaft"));
if(cap)cap.characters="A genuinely SEE-THROUGH glass shaft: the tower's floors and rooms continue behind it and show through the tinted glass, with faint reflections and floor mullions. It stops only at lobby floors (1 and 3) and skips the rest; bigger car with a full passenger FILL, and the same tracked-queue boarding model.";
return { fixed:"express see-through", at:[gx,gy] };
