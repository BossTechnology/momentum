/* harness/probe2.js — corrected: read the locked figures where they live, and
   apply the Config Doc after the mining board exists in Spanish. */
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname,'..');
const TARGET=process.argv[2]||path.join(ROOT,'out','momentum-S68-remirrored.html');
const DATA='/mnt/user-data/uploads/Simulacion_flota_10_camiones_24h_por_segundo.xlsx';
let pass=0,fail=0;
const ok=(n,c,d)=>{c?(pass++,console.log('  ok   '+n+(d?'  · '+d:''))):(fail++,console.log('  FAIL '+n+(d?'  · '+d:'')));};
const near=(a,b,t)=>Math.abs(a-b)<=Math.abs(b)*t;
(async()=>{
  const br=await chromium.launch();
  const page=await br.newPage({viewport:{width:1440,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error'&&!/403|Failed to load resource|net::ERR/.test(m.text()))errors.push(m.text());});
  await page.goto('file://'+TARGET,{waitUntil:'load'}); await page.waitForTimeout(1200);
  console.log('\ntarget: '+path.basename(TARGET));

  console.log('\nA · the light path on the real workbook');
  const t0=Date.now();
  await page.setInputFiles('#dataDocFile',DATA);
  let done=false;
  for(let i=0;i<200;i++){await page.waitForTimeout(5000);
    const st=await page.evaluate(()=>(document.getElementById('dataAttachStatus')||{}).textContent||'');
    if(/^Profiled/.test(st)){done=true;break;} if(/Could not profile/.test(st)){console.log('  '+st);break;}}
  ok('profiles in the page',done,((Date.now()-t0)/1000).toFixed(0)+' s');

  const f=await page.evaluate(()=>{
    const P=MOMENTUM.Bind.profile(); if(!P)return null;
    const cm=P.rollups&&P.rollups.cycleModel;
    const FUEL=Object.keys((P.rollups.perUnit&&P.rollups.perUnit[0]&&P.rollups.perUnit[0].integrated)||{})
                 .find(k=>/fuel/i.test(k));
    let gal=0; (P.rollups.perUnit||[]).forEach(u=>{const v=u.integrated&&u.integrated[FUEL];if(v)gal+=v.value;});
    return {schema:P.schemaVersion, rows:P.coverage.rowsProfiled,
      cycles:cm&&cm.candidates&&cm.candidates[0]&&cm.candidates[0].cycles,
      tons:cm&&cm.candidates&&cm.candidates[0]&&cm.candidates[0].quantity,
      gal:gal, fuelKey:FUEL, carrier:cm&&cm.carrier,
      terminal:cm&&cm.terminalEvent&&cm.terminalEvent.value,
      sched:Object.keys(P.schedules||{}).filter(k=>P.schedules[k].scheduled).join(','),
      thresholds:P.coverage.thresholds, incidents:P.coverage.incidents};});
  console.log('  '+JSON.stringify(f).slice(0,340));
  if(f){
    ok('299 completed cycles',f.cycles===299,String(f.cycles));
    ok('123,867.3 t hauled and dumped',near(f.tons,123867.3,0.0001),f.tons&&f.tons.toLocaleString());
    ok('19,644.7 gal integrated',near(f.gal,19644.7,0.0005),f.gal&&f.gal.toFixed(1));
    ok('the denominator law · 0.1586 gal/ton',near(f.gal/f.tons,0.1586,0.001),(f.gal/f.tons).toFixed(4));
    ok('terminal event is Dumping',f.terminal==='Dumping',String(f.terminal));
    ok('Shift ID is the one clock-scheduled dimension',f.sched==='Shift ID',f.sched);
    ok('incidents 10 cases / 443,083 quarantined',
       f.incidents&&f.incidents.cases===10&&f.incidents.quarantined===443083,JSON.stringify(f.incidents));
  }

  console.log('\nB · the mining board, then the Config Doc');
  const csv=fs.readFileSync(path.join(ROOT,'config','mining-config.csv'),'utf8');
  const rep=await page.evaluate(async(text)=>{
    document.getElementById('langSelect').value='es';
    document.getElementById('industrySelect').value='mining';
    const th=document.getElementById('journeyThemeSelect');
    th.dispatchEvent(new Event('change',{bubbles:true}));
    if(!th.value){for(const o of th.options){if(o.value){th.value=o.value;break;}}}
    document.getElementById('industrySelect').dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    const th2=document.getElementById('journeyThemeSelect');
    if(!th2.value){for(const o of th2.options){if(o.value){th2.value=o.value;break;}}}
    applyConfig(); await new Promise(r=>setTimeout(r,2500));
    const names=KBRS.map(k=>k.name);
    const parsed=MOMENTUM.ConfigDoc.parse(text,'mining-config.csv');
    if(!parsed.ok)return{err:parsed.reason,names:names};
    return {names:names, report:MOMENTUM.ConfigApply.apply(parsed.doc,KBRS),
            theme:document.getElementById('journeyThemeSelect').value};},csv);
  console.log('  KBRs: '+JSON.stringify(rep.names)+'   theme: '+rep.theme);
  if(rep.err){ok('the mining document parses',false,rep.err);}
  else{
    const r=rep.report; console.log('  '+JSON.stringify(r).slice(0,260));
    ok('every result in the document binds',(r.unmatched||[]).length===0,JSON.stringify(r.unmatched||[]));
    ok('answers, risk and conditions all land',
      (r.answers||0)>0&&(r.risk||0)>0&&(r.conditions||0)>0,
      [r.channels+' ch',r.answers+' ans',r.risk+' risk',r.conditions+' cond',r.anomRules+' rules'].join(' · '));
  }
  await page.screenshot({path:path.join(ROOT,'out','probe2-board.png')});
  console.log('\n'+pass+' passed · '+fail+' failed');
  if(errors.length)console.log('page errors: '+errors.slice(0,3).join(' | '));
  await br.close(); process.exit(0);
})();
