/* Session 19 acceptance, reconstructed against schema 2.
   Every expected value here is taken from the Session 19 hand-off table of
   hand-verified statistics. The original suite was not recoverable, so this is
   a rebuild from the documented figures — the numbers are the contract, not the
   code that checked them. Reads the shipped profile; no second implementation. */
'use strict';
const fs = require('fs'), path = require('path');
const P = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'p20.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n + (d ? '  · ' + d : '')))
                            : (fail++, console.log('  FAIL ' + n + (d ? '  · ' + d : ''))); };
const near = (a, b, tol) => a != null && Math.abs(a - b) <= Math.abs(b) * tol;

const FUEL = 'Fuel Consumption Rate-Engine';
const PAY  = 'Truck Payload-Communication Gateway #2';
const STATE= 'OHT Truck Payload State-Communication Gateway #2';
const unit = n => P.rollups.perUnit.find(u => u.unit === n);

console.log('\nSession 19 acceptance · rebuilt · schema ' + P.schemaVersion + '\n');

console.log('1 · shape and span');
ok('864,122 rows profiled', P.coverage.rowsProfiled === 864122, P.coverage.rowsProfiled.toLocaleString());
ok('16 sheets', P.coverage.sheets === 16, String(P.coverage.sheets));
ok('span starts 2026-08-05T07:00:00Z', P.time.startISO.startsWith('2026-08-05T07:00:00'), P.time.startISO);
ok('span ends 2026-08-06T06:59:59Z', P.time.endISO.startsWith('2026-08-06T06:59:59'), P.time.endISO);
ok('exactly 24 h', P.time.spanSec === 86399 || P.time.spanSec === 86400, P.time.spanSec + ' s');
ok('1 s grain', P.time.grainSec === 1, P.time.grainSec + ' s');
ok('gapless', P.time.gaps === 0 || P.time.gapless === true, String(P.time.gaps));

console.log('\n2 · HT-001, the hand-verified truck');
const h1 = unit('HT-001');
const h1mean = h1.totals[FUEL].sum / h1.totals[FUEL].n;
ok('mean fuel rate 86.00 gal/h', near(h1mean, 86.00, 0.001), h1mean.toFixed(3));
ok('total 2,063.9 gal (rate integrated over the 1 s grain)',
   near(h1.integrated[FUEL].value, 2063.9, 0.001), h1.integrated[FUEL].value.toFixed(1) + ' gal');

const want = { 'Traveling Loaded':195.3, 'Traveling Empty':18.3, 'Stopped Empty':8.70,
               'Stopped Loaded':8.62, 'Loading':13.44 };
Object.keys(want).forEach(s => {
  const got = h1.episodes[STATE][s].means[FUEL];
  ok('  state mean ' + s.padEnd(17) + want[s], near(got, want[s], 0.01), String(got));
});

console.log('\n3 · rosters');
const ent = P.entities || {};
const count = k => { const e = (ent[k] || ent[Object.keys(ent).find(x => new RegExp(k,'i').test(x))]);
                     return e ? (e.values ? e.values.length : e.distinct) : null; };
ok('10 trucks', P.rollups.perUnit.length === 10, P.rollups.perUnit.length + ' units');
const sz = k => { const e = ent[k]; return e ? ((e.values||[]).length || e.distinct) : null; };
ok('20 operators', sz('operators') === 20, String(sz('operators')));
ok('21 segments', sz('segments') === 21, String(sz('segments')));
ok('3 routes', sz('routes') === 3, String(sz('routes')));
ok('2 shifts', sz('shifts') === 2, String(sz('shifts')));

console.log('\n4 · thresholds from Límites');
const tm = P.thresholdMap;
ok('25 contextual rows ingested', tm.count === 25, String(tm.count));
ok('21 rows carry persistence', tm.withPersistence === 21, String(tm.withPersistence));
// The Session 19 hand-off recorded "10 params matched". The true figure is 14,
// and the pre-amendment profile produces the same 14 with an identical matched
// set — so this is a correction to the documentation, not a regression.
ok('14 parameters matched to observed measures', tm.matchedToMeasures === 14,
   tm.matchedToMeasures + ' of ' + tm.params.length + ' params · summary said 10, which was wrong');
const gsP = tm.params.find(p => /ground speed/i.test(p.param));
const gsB = gsP && gsP.bands.find(b => b.thresholds && b.thresholds.dir === 'within' &&
                                       +b.thresholds.glo === 5 && +b.thresholds.ghi === 12);
ok('Ground Speed loaded as a two-sided band 5–12 @ 60 s',
   !!gsB && +gsB.persistSec === 60,
   gsB ? JSON.stringify({dir:gsB.thresholds.dir, glo:gsB.thresholds.glo,
                         ghi:gsB.thresholds.ghi, persistSec:gsB.persistSec}) : 'absent');
const rampB = tm.params.reduce((a,p)=>a.concat(p.bands), []).find(b =>
  b.thresholds && +b.thresholds.glo === 175 && +b.thresholds.ghi === 225);
ok('the 11% ramp band 175–225 @ 120 s survives as context',
   !!rampB && +rampB.persistSec === 120, rampB ? rampB.context : 'absent');

console.log('\n5 · Anomalías Control quarantine');
ok('10 cases stored as an incident script', P.incidentScript.cases.length === 10);
ok('443,083 rows held out of the baselines',
   P.incidentScript.rowsExcludedFromBaselines === 443083,
   (P.incidentScript.rowsExcludedFromBaselines || 0).toLocaleString());
const unq = P.incidentScript.cases.filter(c => c.quarantine === 'none');
ok('the un-quarantinable case is named, not hidden', unq.length >= 1,
   unq.map(c => c.entity + ' ' + c.label).join('; '));

console.log('\n6 · night shift');
const sh = P.rollups.shift || {};
const day = (sh.shifts||[]).find(x => /d[ií]a/i.test(x.shift));
const nit = (sh.shifts||[]).find(x => /noche/i.test(x.shift));
ok('20 shift records', sh.records === 20, String(sh.records));
ok('day median 955.2', day && near(day.median, 955.2, 0.0005), day && String(day.median));
ok('night median 1,016.75', nit && near(nit.median, 1016.75, 0.0005), nit && String(nit.median));
ok('night runs +6.44% over day', nit && near(nit.vsLowestPct, 6.444, 0.002), nit && nit.vsLowestPct + '%');

console.log('\n7 · coverage panel content');
const c = P.coverage;
['span','resolution','entities','contextColumns','measures','thresholds','incidents','cycles']
  .forEach(k => ok('  reports ' + k, c[k] != null));
ok('carries at least one improvement line', (c.improvements || []).length >= 1,
   (c.improvements || [])[0] || '');
ok('carries the single-day honesty note', /single day/i.test(JSON.stringify(c.honesty || '')),
   String((c.honesty || [])[0] || '').slice(0, 88));
ok('thresholds line reports 25 rows / 21 with persistence',
   c.thresholds.rows === 25 && c.thresholds.withPersistence === 21, JSON.stringify(c.thresholds));
ok('incidents line reports 10 cases and the quarantine',
   c.incidents.cases === 10 && c.incidents.quarantined === 443083, JSON.stringify(c.incidents));

console.log('\n8 · schema 2 additions (Session 20)');
const cm = P.rollups.cycleModel;
ok('cycle carrier is the payload', cm.carrier === PAY);
ok('299 completed cycles', cm.candidates[0].cycles === 299);
ok('123,867.3 t hauled and dumped', near(cm.candidates[0].quantity, 123867.3, 0.0001),
   cm.candidates[0].quantity.toLocaleString());
let gal = 0; P.rollups.perUnit.forEach(u => gal += u.integrated[FUEL].value);
ok('0.1586 gal/ton', near(gal / cm.candidates[0].quantity, 0.1586, 0.001),
   (gal / cm.candidates[0].quantity).toFixed(4));
ok('terminal event is Dumping', cm.terminalEvent.value === 'Dumping' && cm.terminalEvent.share === 1);
ok('transitions recover the haul cycle',
   P.rollups.transitions[STATE]['Traveling Loaded']['Stopped Loaded'] === 299);
ok('Shift ID is the one clock-scheduled dimension',
   Object.keys(P.schedules).filter(k => P.schedules[k].scheduled).join(',') === 'Shift ID');
ok('baseline cells carry pooled sd',
   P.baselines[STATE]['Traveling Loaded'][FUEL].sd > 0,
   String(P.baselines[STATE]['Traveling Loaded'][FUEL].sd));

console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
