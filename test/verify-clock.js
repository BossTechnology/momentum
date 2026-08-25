/* Release 4, phase 3A — the clock.
 *
 * Sim time, the warm-up window, and the playhead that bounds what may be read.
 *
 * Two of these assertions are regressions against faults that were MEASURED
 * before they were fixed rather than reasoned about afterwards:
 *
 *   persistence  counted wall-clock paints. At the normal cadence a declared
 *                120 s landed after 134 paints, which was right only because
 *                sim time ran 1:1 with the wall. At 600× those same paints
 *                span 72,360 simulated seconds. The suite asserts the unit,
 *                not the number, because the number is what drifts.
 *
 *   reading past the playhead  is not tested by asking a consumer politely.
 *                The clock is asked for a range it must not give, and the
 *                assertion is on what came back.
 *
 * The cores run out of the browser where they can; the control and the wiring
 * run in it, because the interesting failures in a slider are never in the
 * arithmetic.                                                               */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILE = 'file://' + path.join(ROOT, 'public', 'index.html');

let pass = 0, fail = 0;
const ok  = (m, d) => { pass++; console.log('  ok   ' + m + (d ? '  · ' + d : '')); };
const bad = (m, d) => { fail++; console.log('  FAIL ' + m + (d ? '  · ' + d : '')); };
const is  = (c, m, d) => c ? ok(m, d) : bad(m, d);
const head = t => console.log('\n' + t);

function loadCores(){
  const ctx = { console, TextEncoder, TextDecoder };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  ['_configdoc-core.js', '_datadoc-core.js', '_clock-core.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8'), ctx, { filename:f });
  });
  return ctx.MOMENTUM;
}
const M = loadCores();
const C = M.Clock;

/* The mining workbook's real span: 07:00 to 07:00, one second grain. */
const O = Date.UTC(2026, 7, 5, 7, 0, 0);
const E = Date.UTC(2026, 7, 6, 7, 0, 0);
const H = 3600000;
const WINDOWS = [
  { name:'Turno Día',   startsMs:O,        endsMs:O + 12*H },
  { name:'Turno Noche', startsMs:O + 12*H, endsMs:E }
];
const mk = o => C.create(Object.assign({ originMs:O, endMs:E, grainSec:1,
                                         calendar:true, windows:WINDOWS }, o || {}));
const CTX = { originMs:O, spanMs:E - O, windows:WINDOWS };

(async () => {

head('1 · an opening position is read from what a person would write');
{
  const cases = [
    ['1/3',   'ratio',    1/3],
    ['2/5',   'ratio',    0.4],
    ['1/2',   'ratio',    0.5],
    ['33%',   'percent',  0.33],
    ['0.25',  'fraction', 0.25],
    ['40',    'fraction', 0.4],
    ['2026-08-05 15:00:00', 'instant', 1/3]
  ];
  cases.forEach(([input, how, frac]) => {
    const r = C.parseOpening(input, CTX);
    is(r.ok && r.how === how && Math.abs(r.fraction - frac) < 1e-6,
       'reads ' + JSON.stringify(input),
       r.ok ? r.how + ' ' + r.fraction.toFixed(4) : r.why);
  });

  const w = C.parseOpening('Turno Noche', CTX);
  is(w.ok && w.how === 'window' && Math.abs(w.fraction - 0.5) < 1e-9,
     'a named window opens at the moment it starts', w.ok ? w.window : w.why);

  /* The reason ratios exist at all. The claim is about the resolved instant,
     not the caption: the caption rounds to the minute (deliberately, so that a
     span ending at 06:59:59 does not render a 15:00 opening as 14:59), and a
     rounded caption cannot show an eight-second difference. Asserting on the
     caption would have been asserting on the rounding. */
  const dec = C.parseOpening('0.3333', CTX), rat = C.parseOpening('1/3', CTX);
  const clk = mk();
  is(clk.label(rat.fraction) === '33% · 15:00',
     'a third of a 24-hour span is 15:00 exactly', clk.label(rat.fraction));
  is(clk.openingFor(rat.fraction) === O + 8*3600000,
     'and lands exactly on the hour, to the millisecond',
     new Date(clk.openingFor(rat.fraction)).toISOString());
  is(clk.openingFor(dec.fraction) < clk.openingFor(rat.fraction),
     'where the decimal a spreadsheet holds falls short',
     ((clk.openingFor(rat.fraction) - clk.openingFor(dec.fraction)) / 1000).toFixed(1) + ' s early');
}

head('2 · what cannot be read is refused, with the reason');
{
  [['3/2', 'inside the span'], ['-10%', null], ['x/y', null], ['half past', null],
   ['Turno Tarde', 'declared window']].forEach(([input, want]) => {
    const r = C.parseOpening(input, CTX);
    is(!r.ok && !!r.why && (!want || r.why.indexOf(want) >= 0),
       'refuses ' + JSON.stringify(input), r.ok ? 'ACCEPTED' : r.why);
  });

  /* An instant with no calendar is not a smaller offset — it is unreadable,
     and saying so is more use than resolving it to zero. */
  const noCal = C.parseOpening('2026-08-05 15:00:00', { spanMs:E - O, windows:[] });
  is(!noCal.ok && /calendar/.test(noCal.why),
     'an absolute time with no calendar says what to write instead', noCal.why);

  is(C.parseOpening('', CTX).ok === false && C.parseOpening(null, CTX).ok === false,
     'nothing declared is not an error, it is nothing');
}

head('3 · three tiers, in precedence order');
{
  const c = mk();
  const all = { config:'1/3', declared:'Turno Noche', session:'75%' };
  is(c.resolve(all).source === 'session', 'Settings outranks both', c.resolve(all).label);

  const noSess = { config:'1/3', declared:'Turno Noche' };
  is(c.resolve(noSess).source === 'declared',
     'a document outranks the industry default', c.resolve(noSess).label);

  is(c.resolve({ config:'1/3' }).source === 'config',
     'the industry default is used when nothing else spoke');

  const none = c.resolve({});
  is(none.source === 'none' && none.fraction === 0,
     'nothing declared opens at the origin — nothing bound means nothing changes');

  /* Empty is not a declaration. A blank Settings control must fall through to
     the document rather than pin the demo to the start of the span. */
  is(c.resolve({ session:'', declared:'Turno Noche', config:'1/3' }).source === 'declared',
     'a blank Settings control falls through rather than overriding');
}

head('4 · refuse, don\'t demote');
{
  const c = mk();
  const r = c.resolve({ session:'3/2', config:'1/3' });
  is(r.source === 'config', 'an unreadable higher tier does not stop the lower one', r.label);
  is(r.refused.length === 1 && r.refused[0].source === 'session' && !!r.refused[0].why,
     'and the refusal is carried out, named and explained',
     r.refused.length ? r.refused[0].why : 'nothing reported');
  is(r.refused[0].input === '3/2',
     'the refusal quotes what was actually written', String(r.refused[0].input));

  const both = c.resolve({ session:'nonsense', declared:'Turno Tarde', config:'1/3' });
  is(both.refused.length === 2 && both.source === 'config',
     'two bad tiers are both reported, not just the first');
}

head('5 · the playhead bounds what may be read');
{
  const c = mk();
  c.seek(O + 9*H);                                  // sim-time 16:00
  is(c.playhead() === O + 9*H, 'the playhead sits where it was put');

  const w = c.window(O, E);
  is(w.toMs === c.playhead(), 'a range asking for the whole span stops at the playhead');
  is(w.clamped === true && w.requestedToMs === E,
     'and says it was clamped rather than hiding it');

  const inside = c.window(O, O + 2*H);
  is(inside.toMs === O + 2*H && inside.clamped === false,
     'a range wholly behind the playhead is returned intact');

  is(c.bound(E) === c.playhead() && c.bound(O + H) === O + H,
     'bound() clamps the future and leaves the past alone');

  const rows = [{ atMs:O + H }, { atMs:O + 8*H }, { atMs:O + 9*H }, { atMs:O + 15*H }];
  const seen = c.visible(rows);
  is(seen.length === 3 && seen.every(r => r.atMs <= c.playhead()),
     'visible() drops the rows the playhead has not reached', seen.length + ' of 4');

  /* The whole point: asked at 09:00, the answer engine must not see 15:00. */
  const early = mk(); early.seek(O + 2*H);          // sim-time 09:00
  const fuel = [{ atMs:O + 1*H, truck:'HT-001' }, { atMs:O + 8*H, truck:'HT-004' }];
  is(early.visible(fuel).length === 1 && early.visible(fuel)[0].truck === 'HT-001',
     'asked at 09:00 the afternoon is not there', 'HT-004 at 15:00 withheld');

  is(c.readable().toMs === c.playhead() && c.readable().fromMs === O,
     'readable() is the origin to the playhead and nothing further');
}

head('6 · persistence is counted in simulated time');
{
  const c = mk();
  is(c.simMsPerTick(900) === 900, 'at rate 1 a paint buys its own duration');
  c.setRate(600);
  is(c.simMsPerTick(900) === 540000, 'at rate 600 it buys 600× as much', '900 → 540,000');

  /* The regression. 134 paints at 900 ms was the measured cost of a declared
     120 s before the fix; at 600× the same paints must now settle it in one. */
  const need = 120;
  const settle = (rate) => {
    const k = mk({ rate:rate });
    let acc = 0, n = 0;
    while (acc < need*1000 && n < 1000000) { acc += k.simMsPerTick(900); n++; }
    return n;
  };
  is(settle(1) === 134, 'at rate 1, a declared 120 s still takes 134 paints', '134');
  is(settle(600) === 1, 'at rate 600 it takes one, because 120 SIM seconds have passed', '1');
  is(settle(60) === 3, 'and at 60× it takes three', '3');
}

head('7 · the warm-up is run, not asserted');
{
  const c = mk();
  const p = c.plan(1/3);
  is(p.steps === 28800 && p.grainSec === 1,
     'a third of a 24-hour span at 1 s grain is 28,800 steps', p.steps.toLocaleString());
  is(p.withinBudget === true, 'which is inside the budget');

  let walked = 0, last = null, gaps = new Set();
  const r = c.warmUp((ms, step) => {
    if (last != null) gaps.add(ms - last);
    last = ms; walked++;
  }, { fraction:1/3 });
  is(r.ok && walked === 28800, 'and every one of them is walked', walked.toLocaleString());
  is(gaps.size === 1 && gaps.has(1000),
     'at full grain with nothing skipped — sampling is for previews', [...gaps].join(','));
  is(c.playhead() === O + 8*H, 'the playhead lands on 15:00', new Date(c.playhead()).toISOString());
  is(c.warmedTo() === O + 8*H, 'and warmedTo() records where the history ended');

  /* Over budget it refuses. It does not stride, and it does not open anyway
     having quietly walked a tenth of the history. */
  const tight = mk({ budget:1000 });
  const tp = tight.plan(1/3);
  is(tp.withinBudget === false && /budget/.test(tp.why),
     'an unaffordable warm-up is planned as unaffordable before it runs');
  let ran = 0;
  const tr = tight.warmUp(() => ran++, { fraction:1/3 });
  is(tr.ok === false && ran === 0,
     'and refuses rather than striding', 'ran ' + ran + ' steps');
  is(/earlier opening or/.test(tr.why), 'saying what can be done about it');
  is(tight.playhead() === O, 'leaving the playhead where it was');
}

head('8 · every industry declares where its demo opens');
{
  const cfgs = require(path.join(ROOT, 'build', 'configs.json'));
  const inds = Object.keys(cfgs).filter(k => k.charAt(0) !== '_').sort();
  const c = mk();
  let declared = 0, unreadable = [];
  inds.forEach(ind => {
    const csv = fs.readFileSync(path.join(ROOT, 'config', cfgs[ind]), 'utf8');
    const doc = M.ConfigDoc.parse(csv, cfgs[ind]);
    if (!doc.ok || !doc.doc.clock || !doc.doc.clock.opening) { unreadable.push(ind + ' (none)'); return; }
    const r = c.resolve({ config: doc.doc.clock.opening });
    if (r.source !== 'config') { unreadable.push(ind + ' (' + doc.doc.clock.opening + ')'); return; }
    declared++;
  });
  is(declared === inds.length,
     'all ' + inds.length + ' configs declare a readable opening position',
     unreadable.length ? unreadable.join(', ') : declared + '/' + inds.length);

  const mining = M.ConfigDoc.parse(fs.readFileSync(path.join(ROOT, 'config', cfgs.mining), 'utf8'),
                                   cfgs.mining);
  is(mining.doc.clock.opening === '1/3', 'mining opens a third in', mining.doc.clock.opening);
  is(c.label(c.resolve({ config: mining.doc.clock.opening }).fraction) === '33% · 15:00',
     'which on the workbook span is 15:00');
  is(mining.doc.kbrs.length === 3 && (mining.warnings || []).length === 0,
     'and the clock row disturbs nothing else in the document',
     mining.doc.kbrs.length + ' results, ' + (mining.warnings || []).length + ' warnings');

  /* Guidance lives where the reader cannot see it. */
  const raw = fs.readFileSync(path.join(ROOT, 'config', cfgs.mining), 'utf8');
  is(/^# clock/m.test(raw), 'the guidance is written as comment rows');
  is(raw.split('\n').filter(l => /^clock,/.test(l)).length === 1,
     'and exactly one clock row is declared');
}

head('9 · the control, in the browser');
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(FILE);
await page.waitForTimeout(600);
{
  const ui = await page.evaluate(() => ({
    module: typeof MOMENTUM.Clock,
    slider: !!document.getElementById('warmupSlider'),
    min: (document.getElementById('warmupSlider') || {}).min,
    max: (document.getElementById('warmupSlider') || {}).max,
    handler: typeof updateWarmup,
    simTick: typeof _simMsPerTick,
    field: 'warmupOpening' in SB_CFG,
    initial: SB_CFG.warmupOpening
  }));
  is(ui.module === 'object', 'the clock module reached the browser');
  is(ui.slider && ui.handler === 'function', 'the warm-up control is present and wired');
  is(ui.min === '0' && ui.max === '90', 'and spans the span, not the clock', ui.min + '..' + ui.max);
  is(ui.simTick === 'function', '_simMsPerTick is the one door to the persistence unit');
  is(ui.field === true && ui.initial === '',
     'the session field exists and starts empty — nothing bound, nothing changed');

  await page.evaluate(() => updateWarmup(50));
  const after = await page.evaluate(() => ({
    cfg: SB_CFG.warmupOpening,
    label: document.getElementById('warmupLabel').textContent,
    inConfigDoc: !!(SB_CFG.configDoc && SB_CFG.configDoc.doc && SB_CFG.configDoc.doc.clock &&
                    SB_CFG.configDoc.doc.clock.opening === '50%')
  }));
  is(after.cfg === '50%', 'dragging it records a percentage of the span', after.cfg);
  is(after.inConfigDoc === false,
     'and does NOT write itself into the configuration — configuration holds no UI state');

  await page.evaluate(() => updateWarmup(0));
  const back = await page.evaluate(() => SB_CFG.warmupOpening);
  is(back === '', 'returning it to zero hands the decision back to whatever declared one', '""');

  is(errs.length === 0, 'no page errors across the run', errs.slice(0, 2).join(' | '));
}

head('10 · the incident banner obeys Optionality');
{
  /* Found by phase 3A rather than written for it. The banner read incidents
     straight from the bound profile and painted the unit name, so a mining
     workbook bound under a retail board announced a haul truck. It passed
     every gate before this one only because the board always opened at cold
     zero, before any injected case had begun — the mining workbook's earliest
     starts at 09:20. A warm-up walks straight into it.

     The fix is Optionality, not an industry guard: an incident on a measure
     nothing is bound to has nothing to say to this board, whatever industry
     is on screen. */
  const prof = JSON.parse(fs.readFileSync(path.join(ROOT, 'p20.json'), 'utf8'));
  const setup = async (industry) => page.evaluate(async (a) => {
    const [ind, profile] = a;
    if (MOMENTUM.Bind.active()) MOMENTUM.Bind.detach();
    const sel = document.getElementById('industrySelect');
    sel.value = ind; sel.dispatchEvent(new Event('change', { bubbles:true }));
    await new Promise(r => setTimeout(r, 400));
    const th = document.getElementById('journeyThemeSelect');
    if (!th.value) for (const o of th.options) if (o.value) { th.value = o.value; break; }
    MOMENTUM.Bind.attach(profile);
    await new Promise(r => setTimeout(r, 300));
    applyConfig(); await new Promise(r => setTimeout(r, 2600));
    applyExampleConfig(ind); await new Promise(r => setTimeout(r, 700));
    const wu = MOMENTUM.Bind.warmup();
    return { bound: Object.keys(MOMENTUM.Bind.boundMetrics()),
             banner: (document.getElementById('bindIncident') || {}).innerText || null,
             warmupSource: wu && wu.source,
             warmupFraction: wu && +wu.fraction.toFixed(4),
             playhead: new Date(MOMENTUM.Bind.clock().playhead()).toISOString().slice(11, 16) };
  }, [industry, prof]);

  const mining = await setup('mining');
  is(mining.warmupSource === 'config' && Math.abs(mining.warmupFraction - 1/3) < 1e-3,
     'the industry default reaches the clock once the config document applies',
     mining.warmupSource + ' ' + mining.warmupFraction);
  is(mining.playhead === '15:00', 'so a mining demo opens at 15:00', mining.playhead);
  is(mining.bound.length === 0 && mining.banner === null,
     'a blank slate paints no incident, mining data or not — nothing bound, nothing changes');

  const withSource = await page.evaluate(async () => {
    let tp = null;
    for (const s of journeyStages) if ((s.touchpoints || []).length) { tp = s.touchpoints[0]; break; }
    tp.sources = tp.sources || [];
    tp.sources.push({ type:'profile', platform:'Fuel Consumption Rate-Engine',
                      status:'green', score:70, thresholds:{} });
    MOMENTUM.Bind.paintAll(); await new Promise(r => setTimeout(r, 400));
    const on = (document.getElementById('bindIncident') || {}).innerText || null;
    tp.sources.pop();
    MOMENTUM.Bind.paintAll(); await new Promise(r => setTimeout(r, 400));
    return { on: on && on.replace(/\n/g, ' '),
             off: (document.getElementById('bindIncident') || {}).innerText || null,
             bound: Object.keys(MOMENTUM.Bind.boundMetrics()) };
  });
  is(withSource.bound.length === 0, 'unbinding empties the bound set again');
  is(!!withSource.on && /HT-0\d\d/.test(withSource.on),
     'binding the measure brings its incident back — the feature still works',
     withSource.on ? withSource.on.slice(0, 58) : 'no banner');
  is(/15:00/.test(withSource.on || ''),
     'and it reports the simulated instant, not the wall clock');
  is(withSource.off === null, 'unbinding takes it away again');

  const retail = await setup('retail');
  is(retail.bound.length === 0 && retail.banner === null,
     'the mining workbook under a retail board announces nothing');
  is(retail.warmupSource === 'config' && Math.abs(retail.warmupFraction - 0.4) < 1e-3,
     'and retail opens where retail declared, not where mining did',
     retail.warmupFraction + ' at ' + retail.playhead);
}

await browser.close();

console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
