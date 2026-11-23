"use strict";
const SurveyMap=(()=>{
  const W=960,H=550,scale=.95,angle=-.18;
  const dx=Math.cos(angle),dy=Math.sin(angle);
  const palettes=["#aab67a","#84965d","#bec58c","#95a16d","#c6b67e","#80925e","#a3ae76","#b3aa68"];
  const zones=["#bb8058","#cca762","#bcbd7e","#93aa70","#6a8b60"];
  const levels=["< 0,30","0,30–0,44","0,45–0,59","0,60–0,74","≥ 0,75"];
  const color=v=>zones[v<.30?0:v<.45?1:v<.60?2:v<.75?3:4];
  const world=(x,y)=>({x:W/2+scale*((x-300)*dx+(y-200)*dy),y:H/2+scale*((x-300)*dy-(y-200)*dx)});
  function local(sx,sy){const a=(sx-W/2)/scale,b=(sy-H/2)/scale;return {x:300+a*dx+b*dy,y:200+a*dy-b*dx};}
  function coord(c,evt){const r=c.getBoundingClientRect();return local((evt.clientX-r.left)*W/r.width,(evt.clientY-r.top)*H/r.height);}
  function polygon(ctx,pts,fill,stroke,width=1) {
    ctx.beginPath();pts.forEach((p,i)=>{const q=world(...p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}
  }
  function line(ctx,pts,stroke,width=1) {
    ctx.beginPath();pts.forEach((p,i)=>{const q=world(...p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y);});ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();
  }
  let landscape;
  function terrain(){
    if(landscape)return landscape;
    const img=document.createElement("canvas");img.width=W;img.height=H;
    const ctx=img.getContext("2d");
    let seed=1543;
    const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    ctx.fillStyle="#b8b485";ctx.fillRect(0,0,W,H);
    for(let row=-3;row<7;row++)for(let col=-4;col<8;col++){
      const x=col*148+(row%2)*50,y=row*104,w=145,h=100;
      polygon(ctx,[[x,y],[x+w,y+1],[x+w-2,y+h],[x,y+h-2]],palettes[Math.floor(rand()*palettes.length)]);
      for(let i=3;i<h;i+=3.6)line(ctx,[[x+1,y+i],[x+w-2,y+i+1]],rand()>.5?"#ffffff26":"#304d2c26",1);
    }
    for(const c of Field.cells){
      const x=c.x-50,y=c.y-50,base=palettes[Math.floor(rand()*palettes.length)];
      polygon(ctx,[[x,y],[x+99,y],[x+99,y+99],[x,y+99]],base,"#c7c28d",1.3);
      for(let i=3;i<97;i+=3) line(ctx,[[x+2,y+i],[x+97,y+i+.6]],i%2?"#27472233":"#ecedaa58",1.2);
      for(let j=0;j<45;j++){
        const q=world(x+rand()*97,y+rand()*94);ctx.fillStyle=rand()>.5?"#51663c1a":"#e3c97728";ctx.beginPath();ctx.ellipse(q.x,q.y,rand()*10+1,rand()*3+.5,angle,0,Math.PI*2);ctx.fill();
      }
    }
    const canal=[],lane=[];
    for(let y=-300;y<750;y+=8){const x=-64+17*Math.sin(y/65)+6*Math.sin(y/29)-.12*y;canal.push([x,y]);lane.push([x-14,y]);}
    line(ctx,lane,"#6a7050",8);line(ctx,lane,"#d7c995",4);
    line(ctx,canal,"#687953",35);line(ctx,canal,"#94a47d",28);line(ctx,canal,"#6c9390",17);line(ctx,canal,"#91aea4",9);line(ctx,canal,"#729894",2);
    for(let i=0;i<850;i++){
      const y=rand()*900-230,side=rand()>.5?1:-1,x=-64+17*Math.sin(y/65)+6*Math.sin(y/29)-.12*y+side*(12+rand()*11);
      const p=world(x,y);ctx.beginPath();ctx.arc(p.x,p.y,rand()*3+1,0,7);ctx.fillStyle=rand()>.5?"#60745088":"#4c674ba1";ctx.fill();
    }
    line(ctx,[[-140,421],[240,421],[620,419],[820,413]],"#85896c",8);line(ctx,[[-140,421],[240,421],[620,419],[820,413]],"#e0d3a3",5);
    for(let i=0;i<35000;i++){ctx.fillStyle=rand()>.5?"#fff7cb15":"#314a3512";ctx.fillRect(rand()*W,rand()*H,1+rand()*2,1);}
    landscape=img;return img;
  }
  function draw(canvas,{layer="field",selected=null,route=[],position=null,threshold=.45,anomalies=false,showCells=false}={}){
    const ctx=canvas.getContext("2d");canvas.width=W;canvas.height=H;ctx.drawImage(terrain(),0,0);
    if(layer==="ndvi")for(const c of Field.cells){
      const x=c.x-50,y=c.y-50;ctx.globalAlpha=.88;
      polygon(ctx,[[x+1,y+1],[x+99,y+1],[x+99,y+99],[x+1,y+99]],color(Field.last(c.id).ndvi),"#526443",1);
      ctx.globalAlpha=1;
    }
    polygon(ctx,[[0,0],[600,0],[600,400],[0,400]],null,"#f9f7d9",5);
    ctx.setLineDash([7,5]);polygon(ctx,[[0,0],[600,0],[600,400],[0,400]],null,"#315843",2);ctx.setLineDash([]);
    for(const c of Field.cells){
      const q=world(c.x,c.y),v=Field.last(c.id).ndvi;
      if(anomalies && v<threshold){
        ctx.beginPath();ctx.arc(q.x,q.y,21,0,Math.PI*2);ctx.lineWidth=2.6;ctx.strokeStyle="#613c27";ctx.stroke();
      }
      if(showCells||layer==="ndvi"){ctx.font="bold 14px monospace";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle="#203727";ctx.fillText(c.id,q.x,q.y);}
    }
    if(route.length){
      const z=Field.restricted;
      polygon(ctx,[[z.left,z.bottom],[z.right,z.bottom],[z.right,z.top],[z.left,z.top]],"#dbbb89","#745132",1.5);
      for(let x=z.left+3;x<z.right-14;x+=8)line(ctx,[[x,z.bottom],[x+13,z.top]],"#806347",1.4);
      const pts=route.map(p=>[p.x,p.y]);line(ctx,pts,"#fff5d8",6);line(ctx,pts,"#275448",2.8);
      [route[0],route.at(-1)].forEach((p,i)=>{const q=world(p.x,p.y);ctx.beginPath();ctx.arc(q.x,q.y,6,0,7);ctx.fillStyle=i?"#a55132":"#1d5142";ctx.fill();ctx.strokeStyle="#fff7dc";ctx.lineWidth=2;ctx.stroke();});
    }
    if(selected){const c=Field.cells.find(c=>c.id===selected),x=c.x-50,y=c.y-50;
      polygon(ctx,[[x+3,y+3],[x+97,y+3],[x+97,y+97],[x+3,y+97]],null,"#ffffed",5);polygon(ctx,[[x+3,y+3],[x+97,y+3],[x+97,y+97],[x+3,y+97]],null,"#203f34",2);
    }
    if(position){const q=world(position.x,position.y);ctx.beginPath();ctx.arc(q.x,q.y,10,0,7);ctx.fillStyle="#194a3b";ctx.fill();ctx.strokeStyle="white";ctx.lineWidth=3;ctx.stroke();}
    const p=world(140,449);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(angle);ctx.fillStyle="#e9e7bd";ctx.fillRect(-72,-11,144,21);ctx.font="13px monospace";ctx.fillStyle="#43553a";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("ПОЛЕВАЯ ДОРОГА",0,0);ctx.restore();
  }
  return {draw,coord,zones,levels,color};
})();
