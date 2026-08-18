/* harness/probe3.js — the board, reading the real workbook.
   Profiles the 84 MB file in-page against the re-mirrored build, builds the
   mining board in Spanish, applies the real Config Doc, then reads every
   answer's COMPUTED value and compares against the expected mining figures. */
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname,'..');
const TARGET=path.join(ROOT,'out','momentum-S68-remirrored.html');
const DATA='/mnt/user-data/uploads/Simulacion_flota_10_camiones_24h_por_segundo.xlsx';
let pass=0,fail=0;
const ok=(n,c,d)=>{c?(pass++,console.log('  ok   '+n+(d?'  · '+d:''))):(fail++,console.log('  FAIL '+n+(d?'  · '+d:'')));};
(async()=>{
  const br=await chromium.launch();
  const page=await br.newPage({viewport:{width:1440,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error'&&!/403|Failed to load resource|net::ERR/.test(m.text()))errors.push(m.text());});
  await page.goto('file://'+TARGET,{waitUntil:'load'}); await page.waitForTimeout(1200);

  await page.setInputFiles('#dataDocFile',DATA);
  const t0=Date.now(); let done=false;
  for(let i=0;i<200;i++){await page.waitForTimeout(5000);
    const st=await page.evaluate(()=>(document.getElementById('dataAttachStatus')||{}).textContent||'');
    if(/^Profiled/.test(st)){done=true;break;} if(/Could not profile/.test(st)){console.log('  '+st);break;}}
  console.log('profiled in '+((Date.now()-t0)/1000).toFixed(0)+' s · ok='+done);

  const csv=fs.readFileSync(path.join(ROOT,'config','mining-config.csv'),'utf8');
  const res=await page.evaluate(async(text)=>{
    document.getElementById('langSelect').value='es';
    const ind=document.getElementById('industrySelect');
    ind.value='mining'; ind.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,500));
    const th=document.getElementById('journeyThemeSelect');
    if(!th.value){for(const o of th.options){if(o.value){th.value=o.value;break;}}}
    applyConfig(); await new Promise(r=>setTimeout(r,2500));
    const parsed=MOMENTUM.ConfigDoc.parse(text,'mining-config.csv');
    const rep=MOMENTUM.ConfigApply.apply(parsed.doc,KBRS);
    await new Promise(r=>setTimeout(r,1200));
    const out=[];
    KBRS.forEach(k=>{
      (k.answers||[]).forEach(tp=>{
        let r=null; try{ r=window.aeComputed?window.aeComputed(k,tp):null; }catch(e){ r={err:e.message}; }
        out.push({kbr:k.name, name:tp.name, unit:tp.unit,
          label:r&&(r.label!=null?r.label:(r.member!=null?r.member:null)),
          value:r&&(r.value!=null?r.value:null),
          share:r&&r.share, ok:!!r, dump:r?Object.keys(r).join('|'):null});
      });
    });
    return {report:rep, answers:out,
      risk:KBRS.map(k=>({k:k.name,tps:(k.riskTouchpoints||[]).map(t=>t.name)})),
      header:(function(){try{return document.getElementById('hAnomCount')?document.getElementById('hAnomCount').textContent:null;}catch(e){return null;}})()};
  },csv);

  console.log('\napply report: '+JSON.stringify(res.report.unresolved||[],null,0));
  console.log('\nanswers computed off the real workbook:');
  res.answers.forEach(a=>{
    console.log('  ['+a.kbr.slice(0,22).padEnd(22)+'] '+String(a.name).slice(0,32).padEnd(32)+
      ' → '+String(a.label==null?'—':a.label).slice(0,26).padEnd(26)+
      ' '+(a.value==null?'—':(typeof a.value==='number'?a.value.toFixed(4):a.value))+' '+(a.unit||''));
  });
  console.log('\nrisk touchpoints: '+JSON.stringify(res.risk));

  const find=(n)=>res.answers.filter(a=>a.name===n)[0];
  const EXP=[
    ['Mayor Desviación por Unidad','HT-006',0.1756],
    ['Turno con Mayor Consumo','Noche',84.3],
    ['Operador con Mayor Variación','OP-02',9.4],
    ['Segmento de Mayor Consumo','Rampa B-11 Oeste',171.1],
    ['Causa Principal','Saturación de filtro de aire',11.3],
  ];
  console.log('\nagainst the expected mining figures:');
  EXP.forEach(([n,lab,val])=>{
    const a=find(n);
    const gotL=a&&a.label, gotV=a&&a.value;
    const near=gotV!=null&&Math.abs(gotV-val)<=Math.abs(val)*0.02;
    ok(n+' → '+lab+' · '+val, String(gotL)===lab&&near,
       (a?String(gotL)+' · '+(gotV==null?'—':Number(gotV).toFixed(4)):'answer absent'));
  });
  const tot=res.risk.reduce((s,r)=>s+r.tps.length,0);
  ok('five risk touchpoints',tot===5,tot+' · '+JSON.stringify(res.risk.map(r=>r.tps.length)));
  await page.screenshot({path:path.join(ROOT,'out','probe3-board.png'),fullPage:false});
  console.log('\n'+pass+' passed · '+fail+' failed');
  if(errors.length)console.log('page errors: '+errors.slice(0,3).join(' | '));
  await br.close(); process.exit(0);
})();
