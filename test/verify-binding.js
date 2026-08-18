const {chromium}=require('playwright');const fs=require('fs');
const prof=JSON.parse(fs.readFileSync('../p20.json','utf8'));
const csv=fs.readFileSync('../config/mining-config.csv','utf8');
let pass=0,fail=0;
const ok=(n,c,d)=>{c?(pass++,console.log('  ok   '+n+(d?'  · '+d:''))):(fail++,console.log('  FAIL '+n+(d?'  · '+d:'')));};
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:1000}});
const errs=[];p.on('pageerror',e=>errs.push(String(e)));
await p.goto('file://' + require('path').resolve(__dirname,'..','momentum-Simulation_68.html') + '');await p.waitForTimeout(1100);
const r=await p.evaluate(async(a)=>{const [pr,text]=a;
 MOMENTUM.Bind.attach(pr);
 document.getElementById('langSelect').value='es';
 const s=document.getElementById('industrySelect');s.value='mining';
 s.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,500));
 const th=document.getElementById('journeyThemeSelect');
 if(!th.value)for(const o of th.options){if(o.value){th.value=o.value;break;}}
 applyConfig();await new Promise(r=>setTimeout(r,3000));

 // 1 · a different client's document — same three results, different words
 const renamed = text
   .replace(/Combustible por Tonelada/g,'Consumo por Tonelada')
   .replace(/Toneladas Movidas/g,'Tonelaje Transportado')
   .replace(/Horas en Ralentí/g,'Tiempo Muerto');
 const d1 = MOMENTUM.ConfigDoc.parse(renamed,'otro-cliente.csv');
 const rep1 = MOMENTUM.ConfigApply.apply(d1.doc, KBRS, pr);

 // 2 · punctuation-only difference must match by name, not by position
 const punct = text.replace(/Horas en Ralentí/g,'horas-en ralenti');
 const d2 = MOMENTUM.ConfigDoc.parse(punct,'punct.csv');
 const rep2 = MOMENTUM.ConfigApply.apply(d2.doc, KBRS, pr);

 // 3 · a PARTIAL mismatch must NOT bind positionally
 const partial = text.replace(/Horas en Ralentí/g,'Algo Completamente Distinto');
 const d3 = MOMENTUM.ConfigDoc.parse(partial,'partial.csv');
 const rep3 = MOMENTUM.ConfigApply.apply(d3.doc, KBRS, pr);

 // 4 · template vocabulary, with and without a cycle model
 const withCycles = MOMENTUM.ConfigTemplate.generate(KBRS, pr);
 const noCycles = MOMENTUM.ConfigTemplate.generate(KBRS, null);

 // 5 · drawer emptied on detach
 openKbrPanel(KBRS[0].id);
 await new Promise(r=>setTimeout(r,800));
 const beforeDetach = document.querySelectorAll('#kbrActContent .kbr-bound').length;
 if(typeof closeKbrPanel==='function') closeKbrPanel();
 MOMENTUM.Bind.detach();
 await new Promise(r=>setTimeout(r,600));
 const afterDetach = document.querySelectorAll('#kbrActContent .kbr-bound, #kbrActContent .kbr-pace').length;

 return {rep1:{matched:rep1.kbrs,unmatched:rep1.unmatched,pos:rep1.boundByPosition},
   rep2:{matched:rep2.kbrs,pos:rep2.boundByPosition},
   rep3:{matched:rep3.kbrs,unmatched:rep3.unmatched,pos:rep3.boundByPosition},
   tplWith:/__gallons/.test(withCycles), tplWithout:/__gallons/.test(noCycles),
   reservedDims:/unit, roster, incident/.test(noCycles),
   beforeDetach, afterDetach};},[prof,csv]);

console.log('\n1 · a different client, different words for the same results');
ok('all three results bind', r.rep1.matched===3, JSON.stringify(r.rep1.unmatched));
ok('and the pairing is reported, not silent', (r.rep1.pos||[]).length===3, (r.rep1.pos||[]).join(' | '));
console.log('\n2 · punctuation and spacing are not meaning');
ok('matched by name, no positional guess', r.rep2.matched===3 && (r.rep2.pos||[]).length===0, JSON.stringify(r.rep2.pos));
console.log('\n3 · a partial mismatch is a real miss');
ok('two bind, one is reported unmatched', r.rep3.matched===2 && (r.rep3.unmatched||[]).length===1, JSON.stringify(r.rep3.unmatched));
ok('and nothing is bound by position', (r.rep3.pos||[]).length===0);
console.log('\n4 · template vocabulary');
ok('a cycle-model profile is offered __gallons', r.tplWith===true);
ok('a profile without one is NOT', r.tplWithout===false);
ok('the neutral reserved dimensions are still offered', r.reservedDims===true);
console.log('\n5 · the drawer on detach');
ok('the tile is there while bound', r.beforeDetach>=1, String(r.beforeDetach));
ok('and nothing stale survives detaching', r.afterDetach===0, String(r.afterDetach));
console.log('\n'+pass+' passed · '+fail+' failed');
if(errs.length)console.log('errors: '+errs.slice(0,2).join(' | '));
await b.close();process.exit(0);})();
