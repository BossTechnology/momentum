/* Phase 7 · Answer Engine — testing checklist rows 14, 16, 17, 20.
 *
 * The named mining answers are asserted against the DATA, never against a
 * fixture: every expectation below is recomputed from the bound profile in
 * this file before it is compared, so a change in the workbook moves the
 * assertion rather than breaking it silently.                               */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');

const FILE    = 'file://' + path.resolve(__dirname, '..', 'momentum-Simulation_68.html');
const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'p20.json'), 'utf8'));

let pass = 0, fail = 0;
const ok  = (m, d) => { pass++; console.log('  ok   ' + m + (d ? '  · ' + d : '')); };
const bad = (m, d) => { fail++; console.log('  FAIL ' + m + (d ? '  · ' + d : '')); };
const is  = (c, m, d) => c ? ok(m, d) : bad(m, d);
const head = t => console.log('\n' + t);

/* ── ground truth, recomputed here from the raw profile ─────────────────── */

function truth(){
  const per = profile.rollups.perUnit.map(u => ({
    unit: u.unit,
    gal : u.integrated['Fuel Consumption Rate-Engine'].value,
    ton : u.cycles['Truck Payload-Communication Gateway #2'].quantity,
    cyc : u.cycles['Fuel Consumption Rate-Engine'].cycles
  })).map(r => ({ ...r, ratio: r.gal / r.ton }));

  const fleet = per.reduce((a, r) => ({ gal:a.gal + r.gal, ton:a.ton + r.ton,
                                        cyc:a.cyc + r.cyc }), { gal:0, ton:0, cyc:0 });
  const worstUnit = per.slice().sort((a, b) => b.ratio - a.ratio)[0];

  const shift = Object.entries(profile.baselines['Shift ID'])
    .map(([k, v]) => ({ k, mean:v['Fuel Consumption Rate-Engine'].mean }))
    .sort((a, b) => b.mean - a.mean)[0];

  const op = profile.roster.slice()
    .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation))[0];

  const seg = Object.entries(profile.baselines['Pit Position'])
    .map(([k, v]) => ({ k, mean:v['Fuel Consumption Rate-Engine'] &&
                              v['Fuel Consumption Rate-Engine'].mean }))
    .filter(x => x.mean != null).sort((a, b) => b.mean - a.mean)[0];

  const fam = {};
  profile.incidentScript.cases.forEach(c => {
    const f = /filtro(s)? (de aire|#1 y #3)/i.test(c.label)
            ? 'Saturación de filtro de aire' : c.label;
    fam[f] = fam[f] || { n:0, excess:0 };
    fam[f].n++; fam[f].excess += c.expectedExcess;
  });
  const cause = Object.entries(fam).sort((a, b) => b[1].excess - a[1].excess)[0];

  return { per, fleet, worstUnit, shift, op, seg, cause, fam };
}
const T = truth();

/* ── 1 · the core, out of the browser ───────────────────────────────────── */

function loadCore(){
  const sb = { console, Math, JSON, Object, Array, String, Number, isFinite,
               parseFloat, parseInt, Date, RegExp, Infinity };
  sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'momentum-Simulation_68.html'), 'utf8');
  const val = html.match(/root\.MOMENTUM = root\.MOMENTUM \|\| \{\};\n\nvar FORMATS = \{[\s\S]*?MOMENTUM\.Value = \{[\s\S]*?\n\};/);
  vm.runInContext('var root = globalThis;' + val[0], sb, { filename:'value.js' });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'api', '_answer-core.js'), 'utf8'),
                  sb, { filename:'_answer-core.js' });
  /* The mining configuration is a document now, so the suite needs the parser
     and the binder to read it — the same two cores the product uses. */
  ['_configdoc-core.js', '_configapply-core.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'api', f), 'utf8'),
                    sb, { filename:f });
  });
  return sb;
}

(async () => {
console.log('\nPhase 7 · Answer Engine\n');

const sb = loadCore();
const A  = sb.MOMENTUM.Answer;
const P  = profile;

head('1 · the fleet denominator is unbent');
is(Math.abs(T.fleet.gal - 19644.7) < 0.5, 'gallons reproduce', T.fleet.gal.toFixed(1));
is(Math.abs(T.fleet.ton - 123867.3) < 1, 'tons hauled and dumped reproduce', T.fleet.ton.toFixed(1));
is(T.fleet.cyc === 299, '299 completed cycles', String(T.fleet.cyc));
is(Math.abs(T.fleet.gal / T.fleet.ton - 0.1586) < 0.0002, '0.1586 gal/ton', (T.fleet.gal / T.fleet.ton).toFixed(4));

head('2 · one mechanism, nine kinds');
is(A.KINDS.length === 9, 'nine answer kinds are declared', A.KINDS.join(', '));
['person','item','cohort','money','count','percentage','duration','date','reason']
  .forEach(k => is(A.KINDS.indexOf(k) >= 0, 'kind present: ' + k));
is(Object.keys(A.KIND_FORMAT).length === 9, 'every kind maps to one of the four Phase 5 formats');
is(new Set(Object.values(A.KIND_FORMAT)).size <= 4, 'and only the four', [...new Set(Object.values(A.KIND_FORMAT))].join(', '));

head('3 · named mining answers — computed, no demo pools');
/* The MINING table is gone from the product. These fifteen answers are
   declared in a Config Doc — a client deliverable — and this suite now proves
   the DERIVATION rather than the constant: parse the document, bind its names
   to real columns through the profile dictionary, and check the entities that
   come out. A stronger test, because it exercises the path a real client uses
   instead of asserting that an array still says what it said. */
const CD = sb.MOMENTUM.ConfigDoc, CA = sb.MOMENTUM.ConfigApply;
const CSV = fs.readFileSync(path.join(__dirname, 'mining-config.csv'), 'utf8');
const parsedDoc = CD.parse(CSV, 'mining-config.csv');
const declared = {};
(parsedDoc.ok ? parsedDoc.doc.kbrs : []).forEach(k => { declared[k.name] = k; });
const bindReport = { unresolved: [], unmatched: [] };
function queryFor(kbrName, answerName){
  const k = declared[kbrName];
  const da = k && k.answers.filter(a => a.name === answerName)[0];
  return da ? CA.buildQuery(da, P, bindReport) : null;
}
const M = (declared['Combustible por Tonelada'] || { answers: [] }).answers;
const R = n => {
  const q = queryFor('Combustible por Tonelada', n);
  return q ? A.resolve(P, q) : { ok:false, reason:'not declared in the Config Doc' };
};

const r1 = R('Mayor Desviación por Unidad');
is(r1.ok && r1.member === T.worstUnit.unit,
   'Mayor Desviación por Unidad returns the computed worst unit',
   r1.member + ' · ' + r1.magnitude.toFixed(4) + ' gal/ton');
is(Math.abs(r1.magnitude - T.worstUnit.ratio) < 1e-9, 'and its ratio is gallons ÷ tons, per unit',
   T.worstUnit.ratio.toFixed(4));
is(r1.member !== 'HT-003', 'the brief\u2019s HT-003 is not asserted — it ranks fourth on this denominator',
   'HT-003 = ' + T.per.filter(p => p.unit === 'HT-003')[0].ratio.toFixed(4));
is(!/0\.478/.test(r1.display), '0.478 never appears as a computed value', r1.display);

const r2 = R('Turno con Mayor Consumo');
is(r2.ok && /Noche/.test(r2.member), 'Turno con Mayor Consumo returns the night shift', r2.display);
is(r2.member === T.shift.k, 'and it is the ranked leader in the data', T.shift.mean.toFixed(2) + ' gal/h');
is(!/^\d{4}-\d{2}-\d{2}/.test(r2.display), 'the date prefix is dropped from the label, not from the member', r2.member);

const r3 = R('Operador con Mayor Variación');
is(r3.ok && r3.member === 'OP-02', 'Operador con Mayor Variación returns OP-02', r3.display);
is(r3.member === T.op.who, 'and OP-02 is the ranked leader in the roster', (T.op.deviation * 100).toFixed(2) + '%');
is(Math.abs(r3.magnitude * 100 - 9.41) < 0.05,
   'the asserted comparison is the +9.41% roster reading against the fleet baseline',
   (r3.magnitude * 100).toFixed(2) + '%');
is(r3.evidence.feeds.length >= 2 && r3.evidence.feeds.indexOf('roster') >= 0,
   'and it draws on MORE THAN ONE FEED — telemetry for the deviation, roster for the name',
   r3.evidence.feeds.join(' + '));

const r4 = R('Segmento de Mayor Consumo');
is(r4.ok && /Rampa B-11 Oeste/.test(r4.member), 'Segmento de Mayor Consumo returns Rampa B-11 Oeste', r4.display);
is(r4.member === T.seg.k, 'and it is the ranked leader', T.seg.mean.toFixed(2) + ' gal/h');

const r5 = R('Causa Principal');
is(r5.ok && /filtro de aire/i.test(r5.member), 'Causa Principal returns air-filter saturation', r5.display);
is(r5.member === T.cause[0], 'and it leads on summed expected excess', (T.cause[1].excess * 100).toFixed(2) + '%');
is(T.fam['Saturación de filtro de aire'].n === 2,
   'it is also the only repeated cause family — two units, one cause', 'HT-002 + HT-003');

const r6 = A.resolve(P, queryFor('Toneladas Movidas', 'Viajes Completados'));
is(r6.ok && r6.magnitude === 299, 'Viajes Completados returns the cycle count', r6.display);
is(r6.display === '299', 'and a whole count is written whole, not 299.0', r6.display);

head('4 · every named entity is in the data, not in a fixture');
is(T.per.some(p => p.unit === 'HT-006'), 'HT-006 is a profiled unit');
is(profile.roster.some(r => r.who === 'OP-02'), 'OP-02 is in the roster');
is(!!profile.baselines['Pit Position']['RUTA-OESTE-B11 / Rampa B-11 Oeste'], 'Rampa B-11 Oeste is a profiled segment');
is(profile.incidentScript.cases.some(c => /filtro de aire/i.test(c.label)), 'air-filter saturation is a named failure mode');

head('5 · the mining configuration is DECLARED, not compiled in');
is(!A.MINING, 'the MINING table is gone from the product');
is(A.miningAnswers('Combustible por Tonelada') === null,
   'and nothing is returned for a client the code no longer knows about');
is(parsedDoc.ok, 'the Config Doc parses', parsedDoc.ok ? '' : parsedDoc.reason);
['Combustible por Tonelada','Toneladas Movidas','Horas en Ralentí'].forEach(k => {
  const list = (declared[k] || { answers: [] }).answers;
  is(list.length === 5, k + ' declares five answers', list.length + '');
  let allOk = true, sample = '';
  list.forEach(d => {
    const q = CA.buildQuery(d, P, bindReport);
    const r = q ? A.resolve(P, q) : { ok:false, reason:'did not bind' };
    if(!r.ok) { allOk = false; sample = d.name + ': ' + r.reason; }
  });
  is(allOk, 'and all five bind and resolve against the bound profile', sample || 'all resolved');
});
is(bindReport.unresolved.length === 0,
   'every declared name binds to a real column',
   bindReport.unresolved.join('; ') || 'nothing unresolved');
is(declared['Combustible por Tonelada'].riskTouchpoints.length === 5,
   'and the five risk touchpoints are declared too, not hardcoded');

head('6 · per-answer format is the answer\u2019s own');
const pctKbr = { id:'k1', name:'Rate', type:'percentage', unit:'%' };
is(A.formatOf({ name:'Anything', format:'currency' }, pctKbr) === 'currency',
   'a declared format overrides the KBR entirely', 'currency under a percentage KBR');
is(A.formatOf({ name:'Tiempo de espera' }, pctKbr) === 'time',
   'an undeclared format falls back to a SUGGESTION — Spanish', 'time');
is(A.formatOf({ name:'Dur\u00e9e du cycle' }, pctKbr) === 'time',
   'and French', 'time');
is(A.formatOf({ name:'Receita perdida' }, pctKbr) === 'currency',
   'and Portuguese', 'currency');
is(A.formatOf({ name:'Taxa de conclus\u00e3o' }, pctKbr) === 'percentage',
   'and Portuguese percentage', 'percentage');
is(A.suggestFormat('Total Units', '') === 'count', 'English still resolves as it did', 'count');

head('7 · question suggestion — reconciled against the data, not the prose');
const C = A.candidates(P);
is(C.contextColumns === 6 && C.measures === 14, 'the bound profile carries 6 context columns and 14 measures',
   C.contextColumns + ' \u00d7 ' + C.measures);
is(C.nominal === 84, 'nominal candidates are 84, not the 100+ the spec prose predicts', String(C.nominal));
is(C.usable === 70, 'usable candidates are 70 once the degenerate column is dropped', String(C.usable));
is(C.degenerate.length === 1 && /Transmission Current Gear/.test(C.degenerate[0].column),
   'the dropped column is Transmission Gear — one distinct value cannot differentiate',
   C.degenerate[0].column + ' (distinct ' + C.degenerate[0].distinct + ')');
is(C.ranked.every((q, i) => i === 0 || C.ranked[i - 1].variance >= q.variance),
   'the shortlist is ranked by variance — an answer that never changes is not worth a slot');

head('8 · the freezer case — a flag is not a notification');
const freezer = { ok:true, magnitude:-15 };
const f1 = A.flag(freezer, { enabled:true, op:'lt', value:-14, label:'too cold' });
is(f1.flagged === true, '\u221215 \u00b0C flags the answer locally');
is(f1.notifies === false, 'and it does NOT notify — flags never do');
const f2 = A.flag({ ok:true, magnitude:-12 }, { enabled:true, op:'lt', value:-14 });
is(f2.flagged === false, '\u221212 \u00b0C does not trip the local flag');
const draft = A.riskDraft({ id:'k1' }, { tid:'t1', name:'Freezer temp' },
                          { format:'count', unit:'\u00b0C', magnitude:-12 });
is(draft.scope.type === 'answer' && draft.scope.answerId === 't1',
   'but a Risk Meter condition can be scoped to that same answer', draft.scope.label);
is('persistenceSec' in draft, 'and it carries its OWN persistence — 20 minutes is the Risk Meter\u2019s to hold');
is(!('notifies' in A.newFlag()) || A.newFlag().notifies === false,
   'a fresh flag can never be made to notify');
is(A.scopedCondition([{ scope:{ type:'answer', kbrId:'k1', answerId:'t1' } }], 'k1', 't1') != null,
   'once a scoped condition exists the gear finds it and shows a read-only line');
is(A.scopedCondition([], 'k1', 't1') === null, 'and shows the quiet link when none exists');

head('9 · S3 · legacy answers auto-wrap');
const legacy = { tid:'t9', name:'Best Salesperson This Month', sources:[{ status:'green' }] };
const wrapped = A.migrate(legacy, { unit:'$' });
is(wrapped.answerSchema === 1, 'a legacy answer gains the schema', String(wrapped.answerSchema));
is(!!wrapped.format, 'and an explicit format', wrapped.format);
is(wrapped.query === null, 'and NO query — wrapping does not bind it to the profile');
is(!!wrapped.flag && wrapped.flag.notifies === false, 'and an empty, non-notifying flag');
is(A.resolve(P, wrapped.query).ok === false, 'so it still resolves to nothing and keeps its seeded value');
const twice = A.migrate(JSON.parse(JSON.stringify(wrapped)), {});
is(twice.answerSchema === 1, 'migration is idempotent');

head('10 · Optionality — no profile, nothing happens');
is(A.resolve(null, M[0].query).ok === false, 'no profile \u2192 not ok, and never a throw');
is(A.resolve(P, null).ok === false, 'no query \u2192 not ok');
is(A.resolve(P, { dimension:'context:Nope', measure:'x' }).ok === false, 'unknown dimension \u2192 not ok');
is(A.cells(null, null, null, {}).length === 0, 'cells on nothing is empty, not an error');

/* ── the browser ────────────────────────────────────────────────────────── */

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if(m.type() === 'error' && !/403|net::ERR|Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.goto(FILE);
await page.waitForTimeout(2200);

/* BLANK SLATE: the board loads with three unnamed slots and no answers, so
   this suite declares its subject the way a user would — apply the mining
   journey, then attach the mining Config Doc, which is where its fifteen
   answers actually come from. Before, five invented answers per result were
   waiting on the page at load and the suite read those. */
await page.evaluate(() => {
  SB_CFG.industry = 'mining'; SB_CFG.size = 'medium';
  SB_CFG.themeId = templatesFor('mining')[0].id;
  applyJourneyTemplate('mining', currentSizedJourney());
  applyKbrSimulation();
  applyExampleConfig('mining');
  renderKBRs();
});
await page.waitForTimeout(400);

head('11 · the surface');
const surf = await page.evaluate(() => ({
  core:      !!(window.MOMENTUM && MOMENTUM.Answer),
  gearTab:   !!document.getElementById('aeTabConfig'),
  cfgPane:   !!document.getElementById('aePaneConfig'),
  actTab:    !!document.getElementById('aeTabActivity'),
  tpTab:     !!document.getElementById('aeTabTouchpoints'),
  wrapped:   !!(window.aeAnswer && window.aeAnswer.__phase7),
  kbrsBare:  (typeof KBRS !== 'undefined') ? KBRS.length : -1,
  seeder:    typeof window.seedMiningAnswers
}));
is(surf.core, 'MOMENTUM.Answer is on the page');
is(surf.actTab && surf.tpTab && surf.gearTab,
   'Activity, Touchpoints and Configuration (gear) — consistent with every other panel');
is(surf.cfgPane, 'the configuration pane exists');
is(surf.wrapped, 'aeAnswer is wrapped, not replaced');
is(surf.kbrsBare === 3, 'KBRS is reachable as a bare identifier — top-level const is not a window property',
   String(surf.kbrsBare));
is(surf.seeder === 'function', 'the mining seeder is reachable');

head('12 · the panel opens and the gear renders');
const opened = await page.evaluate(() => {
  openKbrAnswerEngine(KBRS[0].id);
  switchAnswerTab('config');
  const pane = document.getElementById('aePaneConfig');
  return { open:  document.getElementById('aePanel').classList.contains('open'),
           active: pane.classList.contains('active'),
           cards: document.querySelectorAll('.ae-cfg-card').length,
           formats: document.querySelectorAll('.ae-cfg-card select[data-k="format"]').length,
           links: document.querySelectorAll('.ae-cfg-link').length,
           notes: document.querySelectorAll('.ae-cfg-note').length };
});
is(opened.open && opened.active, 'the Configuration tab activates its pane');
is(opened.cards > 0, 'and renders one card per answer', String(opened.cards));
is(opened.formats === opened.cards, 'every answer carries its OWN format control', String(opened.formats));
is(opened.links === opened.cards, 'and its own quiet Add-to-Risk-Meter link', String(opened.links));
is(opened.notes === opened.cards, 'each stating that a flag never notifies', String(opened.notes));

head('13 · Add to Risk Meter turns the link into a read-only line');
const handed = await page.evaluate(() => {
  const kbr = KBRS[0];
  const tp = kbr.answers[0];
  const before = document.querySelectorAll('.ae-cfg-link').length;
  addAnswerToRiskMeter(kbr, tp);
  const cond = kbr.riskConditions[kbr.riskConditions.length - 1];
  return { before, after: document.querySelectorAll('.ae-cfg-link').length,
           ro: document.querySelectorAll('.ae-cfg-ro').length,
           scoped: cond && cond.scope && cond.scope.type,
           answerId: cond && cond.scope && cond.scope.answerId === tp.tid,
           persistence: cond && ('persistenceSec' in cond) };
});
is(handed.after === handed.before - 1, 'the link is gone for that answer',
   handed.before + ' \u2192 ' + handed.after);
is(handed.ro >= 1, 'and a read-only line stands in its place');
is(handed.scoped === 'answer' && handed.answerId, 'the condition is scoped to the answer, not the KBR');
is(handed.persistence, 'and it owns its own persistence');

head('14 · switching away leaves the other tabs as they were');
const back = await page.evaluate(() => {
  switchAnswerTab('activity');
  return { act: document.getElementById('aePaneActivity').classList.contains('active'),
           cfg: document.getElementById('aePaneConfig').classList.contains('active'),
           tab: document.getElementById('aeTabConfig').classList.contains('active') };
});
is(back.act && !back.cfg && !back.tab, 'Activity comes back and the gear stands down');

head('15 · Optionality on the page — unbound answers keep their seeded value');
const unbound = await page.evaluate(() => {
  const kbr = KBRS[0], tp = kbr.answers[0];
  const a = aeAnswer(kbr, tp), b = aeAnswer(kbr, tp);
  return { same: a.value === b.value, computed: !!a.computed, value: a.value,
           hist: Array.isArray(a.history) && a.history.length === 12 };
});
is(!unbound.computed, 'with no profile bound the answer is NOT computed', unbound.value);
is(unbound.same, 'and it is hash-stable across calls');
is(unbound.hist, 'and it keeps its twelve-point drift');

head('16 \u00b7 the Optionality law, restated for a blank slate');
/* This used to diff the loaded board against Simulation_19's and require them
   byte-identical. That comparison assumed both files arrive furnished — three
   named results with five seeded answers each — and it cannot survive a build
   that arrives with nothing, because the baseline it compares against is the
   furniture.

   The law is unchanged and the test now states it directly: a board nobody has
   told anything is empty, and stays empty. Nothing bound means nothing
   changes. */
const blank = await (async () => {
  const p2 = await browser.newPage();
  await p2.goto(FILE); await p2.waitForTimeout(1600);
  const read = () => p2.evaluate(() => ({
    slots: KBRS.length,
    named: KBRS.filter(k => k.name).length,
    answers: KBRS.reduce((a, k) => a + (k.answers || []).length, 0),
    tps: KBRS.reduce((a, k) => a + (k.touchpoints || []).length, 0),
    risk: KBRS.reduce((a, k) => a + (k.riskTouchpoints || []).length, 0),
    conds: KBRS.reduce((a, k) => a + (k.riskConditions || []).length, 0),
    stageTps: journeyStages.reduce((a, s) => a + (s.touchpoints || []).length, 0),
    active: journeyStages.filter(s => s.state && s.state !== 'inactive').length,
  }));
  const first = await read();
  await p2.waitForTimeout(2500);          // let every timer on the page run
  const second = await read();
  await p2.close();
  return { first, second };
})();
is(blank.first.slots === 3 && blank.first.named === 0,
   'the board loads with three slots and not one declared result',
   blank.first.named + ' named of ' + blank.first.slots);
is(blank.first.answers === 0 && blank.first.tps === 0 && blank.first.risk === 0 &&
   blank.first.conds === 0,
   'nothing is declared about any of them \u2014 no answers, touchpoints, indicators or conditions',
   JSON.stringify(blank.first));
is(blank.first.stageTps === 0 && blank.first.active === 0,
   'and the journey is empty, with no stage active');
is(JSON.stringify(blank.first) === JSON.stringify(blank.second),
   'and it is still empty after the timers have run \u2014 nothing creeps in');

head('17 · the page');
is(errors.length === 0, 'no page errors across the whole run',
   errors.length ? errors.slice(0, 3).join(' | ') : '');

await browser.close();
console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
