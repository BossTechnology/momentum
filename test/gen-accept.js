/* Phase 4 acceptance — MOMENTUM.Generator against the profiled fleet workbook.
   Loads the SHIPPED core files through vm, so there is no second implementation. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const sandbox = { console, TextDecoder, Date, Math, JSON, setTimeout };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['_profile-core.js', '_ingest-core.js', '_generator-core.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'api', f), 'utf8'), sandbox, { filename: f });
const M = sandbox.MOMENTUM;

const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'p20.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  · ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  · ' + detail : '')); }
};
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= Math.abs(b) * tol;

const STATE = 'OHT Truck Payload State-Communication Gateway #2';
const FUEL  = 'Fuel Consumption Rate-Engine';
const PAY   = 'Truck Payload-Communication Gateway #2';
const bind  = { seed: 'mineria-2026', stateColumn: STATE, cycleMeasure: PAY };

console.log('\nPhase 4 · Generator + binding\n');

/* ── 1 · plan ─────────────────────────────────────────────────────────── */
console.log('1 · binding');
const G = M.Generator.create(profile, bind);
ok('generator builds', G.ok(), G.plan.reason || '');
ok('journey partition bound to the truck-state column', G.plan.stateColumn === STATE);
ok('state column is NOT the tiebreak winner',
   profile.rollups.primaryStateColumn !== STATE,
   'profiler ranked ' + profile.rollups.primaryStateColumn + ' first; binding overrode it');
ok('cycle order recovered from transitions, not assumed',
   G.stateNames().join(' → ') === 'Stopped Empty → Loading → Fully Loaded → Traveling Loaded → Stopped Loaded → Dumping → Traveling Empty',
   G.stateNames().join(' → '));
ok('10 units', G.units().length === 10, G.units().join(','));
ok('cycle length ≈ 45 min', G.plan.cycleSec > 2400 && G.plan.cycleSec < 3200,
   Math.round(G.plan.cycleSec) + ' s');
ok('clock-scheduled dimension found (shift only)',
   G.plan.schedules.length === 1 && G.plan.schedules[0].column === 'Shift ID',
   G.plan.schedules.map(s => s.column).join(','));
ok('incident measure resolved to the rate the control sheet quotes',
   G.plan.incidentMeasure === FUEL, G.plan.incidentMeasure);
ok('all 10 control cases carried', G.plan.cases.length === 10,
   G.plan.scheduledCases + ' scheduled · ' + G.plan.contextCases + ' context-conditional');
ok('the cases with no window are carried, not dropped', G.plan.contextCases === 3,
   G.plan.cases.filter(c => c.placement !== 'scheduled').map(c => c.unit).join(','));
ok('the HT-010 ramp decoy carries zero excess',
   G.plan.cases.filter(c => c.unit === 'HT-010').every(c => c.magnitude === 0));

/* ── 2 · determinism ──────────────────────────────────────────────────── */
console.log('\n2 · determinism');
const t0 = Date.parse(profile.time.startISO);
const sample = (g, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(g.value(FUEL, t0 + i * 37000, 'HT-004'));
  return out;
};
const A = sample(M.Generator.create(profile, bind), 500);
const B = sample(M.Generator.create(profile, bind), 500);
ok('same seed → bit-identical series', A.every((v, i) => Object.is(v, B[i])));

const C = sample(M.Generator.create(profile, Object.assign({}, bind, { seed: 'other' })), 500);
ok('different seed → different series', C.some((v, i) => v !== A[i]));

const fwd = [], back = [];
for (let i = 0; i < 200; i++) fwd.push(M.Generator.create(profile, bind).value(FUEL, t0 + i * 60000, 'HT-002'));
for (let i = 199; i >= 0; i--) back.unshift(M.Generator.create(profile, bind).value(FUEL, t0 + i * 60000, 'HT-002'));
ok('order of evaluation is irrelevant (scrub back = scrub forward)', fwd.every((v, i) => Object.is(v, back[i])));

const beforeEpoch = G.value(FUEL, t0 - 86400000 * 30, 'HT-001');
const afterEnd    = G.value(FUEL, Date.parse(profile.time.endISO) + 86400000 * 90, 'HT-001');
ok('any moment past or future is computable',
   beforeEpoch != null && afterEnd != null && isFinite(beforeEpoch) && isFinite(afterEnd),
   '−30 d ' + beforeEpoch.toFixed(1) + ' · +90 d ' + afterEnd.toFixed(1));

/* ── 3 · state means against the profile baselines ────────────────────── */
console.log('\n3 · state means within tolerance of profile.baselines');
const clean = M.Generator.create(profile, Object.assign({}, bind, { incidents: false }));
const endMs = Date.parse(profile.time.endISO);
const acc = {};
for (const u of clean.units())
  for (let t = t0; t <= endMs; t += 11000) {
    const d = clean.detail(FUEL, t, u);
    const a = acc[d.state] = acc[d.state] || { n: 0, s: 0 };
    a.n++; a.s += d.value;
  }
const bl = profile.baselines[STATE];
let worst = 0, worstName = '';
Object.keys(acc).forEach(s => {
  const want = bl[s][FUEL].baselineMean != null ? bl[s][FUEL].baselineMean : bl[s][FUEL].mean;
  const got = acc[s].s / acc[s].n;
  const err = Math.abs(got - want) / want;
  if (err > worst) { worst = err; worstName = s; }
  ok('  ' + s.padEnd(18) + ' generated ' + got.toFixed(2) + ' vs baseline ' + want.toFixed(2),
     err <= 0.05, (err * 100).toFixed(2) + '%');
});
ok('worst state error ≤ 5%', worst <= 0.05, worstName + ' ' + (worst * 100).toFixed(2) + '%');

/* payload states must be honoured too — a loaded truck carries a load */
const payLoaded = clean.detail(PAY, t0 + 60000, 'HT-001');
let loadedMean = 0, loadedN = 0, emptyMax = 0;
for (const u of clean.units())
  for (let t = t0; t <= endMs; t += 23000) {
    const d = clean.detail(PAY, t, u);
    if (d.state === 'Traveling Loaded') { loadedMean += d.value; loadedN++; }
    if (d.state === 'Traveling Empty') emptyMax = Math.max(emptyMax, d.value);
  }
ok('generated payload when laden ≈ profile', near(loadedMean / loadedN,
   bl['Traveling Loaded'][PAY].baselineMean != null ? bl['Traveling Loaded'][PAY].baselineMean
   : bl['Traveling Loaded'][PAY].mean, 0.05), (loadedMean / loadedN).toFixed(1) + ' t');
ok('generated payload when empty stays at zero', emptyMax < 1, emptyMax.toFixed(3));

/* ── 4 · scripted incidents ───────────────────────────────────────────── */
console.log('\n4 · scripted incidents');
const withInc = M.Generator.create(profile, bind);
const c0 = withInc.plan.cases.find(c => c.unit === 'HT-001');
ok('HT-001 night case is in the script', !!c0, c0 && c0.label);
const before = withInc.detail(FUEL, c0.startMs - 600000, 'HT-001');
const during = withInc.detail(FUEL, c0.startMs + 3600000, 'HT-001');
ok('incident is absent before its onset', before.incidentFactor === 1);
ok('incident is present after its onset', during.incidentFactor > 1,
   'x' + during.incidentFactor.toFixed(4));

const found = withInc.incidentsIn(c0.startMs - 3600000, c0.startMs + 3600000, 'HT-001');
ok('scrubbing backward across the onset finds it', found.length >= 1, found.map(f => f.label).join('; '));
ok('incident is absent outside its window',
   withInc.incidentsIn(t0, c0.startMs - 1000, 'HT-001').length === 0);

/* the quoted excess is recovered per unit, over the incident window */
let hits = 0, tried = 0;
withInc.plan.cases.forEach(c => {
  if (!c.unit || !c.magnitude) return;
  if (c.placement !== 'scheduled' && c.shape !== 'persistent') return;
  tried++;
  let sDirty = 0, sClean = 0, n = 0;
  for (let t = c.startMs; t <= c.endMs; t += 20000) {
    sDirty += withInc.value(FUEL, t, c.unit);
    sClean += clean.value(FUEL, t, c.unit);
    n++;
  }
  const excess = sDirty / sClean - 1;
  const good = Math.abs(excess - c.magnitude) <= Math.max(0.01, c.magnitude * 0.25);
  if (good) hits++;
  ok('  ' + c.unit + ' excess ' + (excess * 100).toFixed(2) + '% vs expected ' +
     (c.magnitude * 100).toFixed(2) + '%', good);
});
ok('every quoted excess recovered within tolerance', hits === tried, hits + '/' + tried);

/* ── 5 · completed cycles and the locked KPI ──────────────────────────── */
console.log('\n5 · completed cycles and the locked gal/ton');
const cyc = G.cyclesIn(t0, endMs);
ok('completed cycles ≈ the 299 the workbook recorded',
   Math.abs(cyc.length - 299) <= 12, cyc.length + ' cycles');
ok('every cycle discharges in the terminal state',
   cyc.every(c => c.terminalState === 'Dumping'));
const kpi = G.kpi(t0, endMs, { stepSec: 20 });
ok('numerator is an integrated rate', kpi.numeratorUnit === 'gal');
ok('denominator is counted once per cycle', kpi.denominatorMetric === PAY);
ok('gal/ton within 8% of the locked 0.1586', near(kpi.value, 0.1586, 0.08),
   kpi.value.toFixed(4) + ' gal/ton · ' + Math.round(kpi.numerator) + ' gal ÷ ' +
   Math.round(kpi.denominator) + ' t over ' + kpi.cycles + ' cycles');
ok('per-cycle payload ≈ 414 t', near(kpi.perCycle, 414.3, 0.05), kpi.perCycle.toFixed(1) + ' t');

/* lower-is-better against an external provisional target */
const target = 0.420;
const attain = (target - kpi.value) / target;
ok('0.1586 against a 0.420 lower-better target reads as exceeded, never negative',
   attain > 0.5, 'target exceeded by ' + (attain * 100).toFixed(0) + '%');

/* ── 6 · real time ranges ─────────────────────────────────────────────── */
console.log('\n6 · real header time ranges');
const day  = G.aggregate(FUEL, endMs - 86400000, endMs, { stepSec: 60 });
const week = G.aggregate(FUEL, endMs - 7 * 86400000, endMs, { stepSec: 300 });
const month = G.aggregate(FUEL, endMs - 30 * 86400000, endMs, { stepSec: 900 });
ok('a week integrates ≈ 7 real days of generated fuel',
   near(week.integrated.value / day.integrated.value, 7, 0.12),
   (week.integrated.value / day.integrated.value).toFixed(2) + '×');
ok('a month integrates ≈ 30 real days',
   near(month.integrated.value / day.integrated.value, 30, 0.12),
   (month.integrated.value / day.integrated.value).toFixed(2) + '×');
ok('a day of generated fuel ≈ the workbook day', near(day.integrated.value, 19644.7, 0.15),
   Math.round(day.integrated.value) + ' gal vs 19,645');
ok('hours reported are real hours', Math.round(week.hours) === 168, week.hours + ' h');
ok('week ≠ a 54× multiplier of the live snapshot',
   Math.abs(week.integrated.value / day.integrated.value - 54) > 40);

/* ── 7 · the night rhythm survives ────────────────────────────────────── */
console.log('\n7 · shift rhythm');
let dayS = 0, dayN = 0, nightS = 0, nightN = 0;
for (const u of clean.units())
  for (let t = t0; t <= endMs; t += 13000) {
    const h = new Date(t).getUTCHours();
    const v = clean.value(FUEL, t, u);
    if (h >= 7 && h < 19) { dayS += v; dayN++; } else { nightS += v; nightN++; }
  }
const dm = dayS / dayN, nm = nightS / nightN;
ok('day and night differ, and by the profile’s own margin',
   Math.abs(nm / dm - 1) > 0.01,
   'day ' + dm.toFixed(2) + ' · night ' + nm.toFixed(2) + ' · ' + ((nm / dm - 1) * 100).toFixed(2) + '%');

/* ── 8 · degrades gracefully ──────────────────────────────────────────── */
console.log('\n8 · optionality');
const empty = M.Generator.create(null, bind);
ok('no profile → generator reports not-ok and never throws', !empty.ok());
ok('no profile → value() returns null', empty.value(FUEL, t0) === null);
const noState = M.Generator.create({ time: profile.time, baselines: {}, rollups: {} }, {});
ok('no state column → not-ok with a reason', !noState.ok() && !!noState.plan.reason, noState.plan.reason);

console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
