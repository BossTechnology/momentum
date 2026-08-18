/* The Config Doc slot, end to end, through the real UI path:
   attach -> parse -> hold -> Apply Simulation -> ConfigApply(with profile)
   -> the board. Uses the schema-3 profile already derived from the workbook,
   so this proves the three fixes without a five-minute re-profile. */
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const profile=JSON.parse(fs.readFileSync('../p20.json','utf8'));
const CFG=process.argv[2]||'../config/mining-config.csv';
let pass=0,fail=0;
const ok=(n,c,d)=>{c?(pass++,console.log('  ok   '+n+(d?'  · '+d:''))):(fail++,console.log('  FAIL '+n+(d?'  · '+d:'')));};
const near=(a,b,t)=>a!=null&&Math.abs(a-b)<=Math.abs(b)*t;
(async()=>{
 const br=await chromium.launch();
 const page=await br.newPage({viewport:{width:1440,height:900}});
 const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error'&&!/403|Failed to load resource|net::ERR/.test(m.text()))errors.push(m.text());});
 await page.goto('file://../public/index.html',{waitUntil:'load'});
 await page.waitForTimeout(1200);
 console.log('\nconfig doc: '+path.basename(CFG));

 console.log('\n1 · the slot');
 await page.setInputFiles('#cfgDocFile',CFG);
 await page.waitForTimeout(1500);
 const c=await page.evaluate(()=>({held:!!(SB_CFG.configDoc&&SB_CFG.configDoc.doc),
   st:(document.getElementById('cfgAttachStatus')||{}).textContent}));
 ok('parses on attach and holds the document',c.held);
 console.log('       status: '+c.st);

 console.log('\n2 · Apply Simulation · mining · Spanish · profile bound');
 const r=await page.evaluate(async(prof)=>{
   MOMENTUM.Bind.attach(prof);
   document.getElementById('langSelect').value='es';
   const s=document.getElementById('industrySelect');
   s.value='mining'; s.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(r=>setTimeout(r,500));
   const th=document.getElementById('journeyThemeSelect');
   if(!th.value)for(const o of th.options){if(o.value){th.value=o.value;break;}}
   applyConfig(); await new Promise(r=>setTimeout(r,3500));
   const out=[];
   KBRS.forEach(k=>(k.answers||[]).forEach(tp=>{
     let x=null; try{x=window.aeComputed?window.aeComputed(k,tp):null;}catch(e){}
     out.push({name:tp.name,member:x&&x.member,mag:x&&x.magnitude,unit:tp.unit,declared:!!tp.declared});}));
   return {kbrs:KBRS.map(k=>k.name),answers:out,
     risk:KBRS.reduce((a,k)=>a.concat((k.riskTouchpoints||[]).map(t=>t.name)),[]),
     toast:(document.querySelector('.toast, #toast')||{}).textContent||''};
 },profile);
 console.log('       KBRs: '+JSON.stringify(r.kbrs));
 ok('five risk touchpoints',r.risk.length===5,String(r.risk.length));

 console.log('\n3 · every declared answer bound to a real column');
 const decl=r.answers.filter(a=>a.declared);
 const bound=decl.filter(a=>a.mag!=null||a.member!=null);
 ok('all '+decl.length+' declared answers compute',bound.length===decl.length,
    bound.length+' of '+decl.length);
 decl.forEach(a=>console.log('       '+String(a.name).slice(0,32).padEnd(32)+' → '+
   String(a.member==null?'—':a.member).slice(0,30).padEnd(30)+
   (a.mag==null?'—':Number(a.mag).toFixed(4))+' '+(a.unit||'')));

 console.log('\n4 · the expected mining figures');
 const f=n=>r.answers.filter(a=>a.name===n)[0];
 [['Mayor Desviación por Unidad','HT-006',0.1756],
  ['Turno con Mayor Consumo','Noche',84.3],
  ['Operador con Mayor Variación','OP-02',0.094],
  ['Segmento de Mayor Consumo','Rampa B-11 Oeste',171.1],
  ['Causa Principal','Saturación de filtro de aire',0.113],
  ['Viajes Completados',null,299]].forEach(([n,lab,v])=>{
   const a=f(n);
   const labOk=lab===null?true:(a&&String(a.member||'').indexOf(lab)>=0);
   ok(n+(lab?' → '+lab:''),a&&labOk&&near(a.mag,v,0.02),
      a?String(a.member)+' · '+(a.mag==null?'—':Number(a.mag).toFixed(4)):'absent');});
 ok('no page errors',errors.length===0,errors.slice(0,2).join(' | '));
 await page.screenshot({path:'../mining-board.png'});
 console.log('\n'+pass+' passed · '+fail+' failed');
 await br.close(); process.exit(0);
})();
