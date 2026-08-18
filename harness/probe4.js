/* harness/probe4.js — isolates the binding question from the profiling one.
   Attaches the already-derived schema-3 profile (no 5-minute re-profile), then
   applies the real mining Config Doc TWICE: once the way the build calls it,
   and once passing the profile ConfigApply actually asks for. */
const { chromium } = require('playwright');
const fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname,'..');
const TARGET=process.argv[2]||path.join(ROOT,'momentum-Simulation_68.html');
const profile=JSON.parse(fs.readFileSync(path.join(ROOT,'p20.json'),'utf8'));
const csv=fs.readFileSync(path.join(ROOT,'config','mining-config.csv'),'utf8');
let pass=0,fail=0;
const ok=(n,c,d)=>{c?(pass++,console.log('  ok   '+n+(d?'  · '+d:''))):(fail++,console.log('  FAIL '+n+(d?'  · '+d:'')));};
(async()=>{
  const br=await chromium.launch();
  const page=await br.newPage({viewport:{width:1440,height:900}});
  const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
  page.on('console',m=>{if(m.type()==='error'&&!/403|Failed to load resource|net::ERR/.test(m.text()))errors.push(m.text());});
  await page.goto('file://'+TARGET,{waitUntil:'load'}); await page.waitForTimeout(1000);
  console.log('target: '+path.basename(TARGET));

  const res=await page.evaluate(async(a)=>{
    const [prof,text]=a;
    document.getElementById('langSelect').value='es';
    const ind=document.getElementById('industrySelect');
    ind.value='mining'; ind.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    const th=document.getElementById('journeyThemeSelect');
    if(!th.value){for(const o of th.options){if(o.value){th.value=o.value;break;}}}
    applyConfig(); await new Promise(r=>setTimeout(r,2500));
    MOMENTUM.Bind.attach(prof);
    await new Promise(r=>setTimeout(r,800));

    const parsed=MOMENTUM.ConfigDoc.parse(text,'mining-config.csv');
    const asBuilt=MOMENTUM.ConfigApply.apply(parsed.doc,KBRS);            // 2 args, as the build calls it
    const withProf=MOMENTUM.ConfigApply.apply(parsed.doc,KBRS,prof);      // 3 args, as the signature asks
    await new Promise(r=>setTimeout(r,800));

    const out=[];
    KBRS.forEach(k=>(k.answers||[]).forEach(tp=>{
      let r=null; try{ r=window.aeComputed?window.aeComputed(k,tp):null; }catch(e){}
      out.push({kbr:k.name,name:tp.name,unit:tp.unit,
        member:r&&r.member, mag:r&&r.magnitude, ok:!!(r&&r.ok), reason:r&&r.reason});
    }));
    return {asBuilt:asBuilt.unresolved.length, withProf:withProf.unresolved.length,
            unresolved:withProf.unresolved, answers:out};
  },[profile,csv]);

  console.log('\nunresolved · apply(doc,KBRS)      = '+res.asBuilt);
  console.log('unresolved · apply(doc,KBRS,prof) = '+res.withProf);
  if(res.unresolved.length) console.log('  still unresolved: '+JSON.stringify(res.unresolved));

  console.log('\nanswers computed:');
  res.answers.filter(a=>a.member!=null||a.mag!=null).forEach(a=>
    console.log('  '+String(a.name).slice(0,32).padEnd(32)+' → '+
      String(a.member==null?'—':a.member).slice(0,28).padEnd(28)+
      (a.mag==null?'—':Number(a.mag).toFixed(4))+' '+(a.unit||'')));

  const find=n=>res.answers.filter(a=>a.name===n)[0];
  const EXP=[['Mayor Desviación por Unidad','HT-006',0.1756],
             ['Turno con Mayor Consumo','Noche',84.3],
             ['Operador con Mayor Variación','OP-02',9.4],
             ['Segmento de Mayor Consumo','Rampa B-11 Oeste',171.1],
             ['Causa Principal','Saturación de filtro de aire',11.3]];
  console.log('\nagainst the expected mining figures:');
  EXP.forEach(([n,lab,val])=>{
    const a=find(n);
    const near=a&&a.mag!=null&&Math.abs(a.mag-val)<=Math.abs(val)*0.02;
    ok(n,String(a&&a.member)===lab&&near,
       a?String(a.member)+' · '+(a.mag==null?'—':Number(a.mag).toFixed(4)):'absent');
  });
  console.log('\n'+pass+' passed · '+fail+' failed');
  if(errors.length)console.log('page errors: '+errors.slice(0,3).join(' | '));
  await br.close(); process.exit(0);
})();
