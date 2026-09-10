/* ═══════════════════════════════════════════════════════════════════════════
   test/verify-mining.js — phase 4 · seeded synthesis validation

   Four things are asserted here, and each was chosen because a weaker version
   of it could not fail:

   1D  Ground truth is a RECORD, not a literal. test/fixtures/mining-ground-truth.json
       carries the operands, the workbook md5 that produced them, the method,
       and the phase-alignment definition. The gate cannot recompute it (84 MB,
       not in the repo) so it is pinned — but it is reconstructible with
       `node harness/mining-truth.js <workbook.xlsx>`, and the record says which
       workbook. A bare 0.1586 in a test file is a note; the denominator law
       says ground truth never comes from notes.

   2C  kpi() must DISCLOSE the step it integrated at. aggregate() falls back to
       autoStep(), so an official number can be an estimate at a coarse stride
       and read identically to a full-fidelity one. Asserting that strided and
       unstrided agree would be worthless — measured, they differ by 0.014%, so
       any safe tolerance passes on any code. What can fail is the disclosure.

   3C  Targets and measurements are separated by ROLE, not by value. 0.1507 is
       BOTH the 5% aspiration and HT-007's real measurement, so a test banning
       the value would condemn correct behaviour. The hazard is narrower and
       worse: HT-007 reaches 0.1507 by carrying an injected overload, so a board
       could show it as target-achieving on the strength of an inflated
       denominator, with the fault recorded in a sheet nobody is looking at.

   4b  The generator counts ~303 cycles where the workbook counts 299, and that
       is NOT a cyclesIn() defect — per-cycle payload matches to 0.017%. It is a
       phase convention: the workbook is a shift start, the generator uses
       uniform random phase. Each side is asserted against what is actually true
       OF THAT SIDE, rather than tolerating a gap that would hide a real
       regression.

   Negative control: run against the pre-phase-4 build. 2C assertions must FAIL
   (kpi() had no stepSec field), not crash.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const sandbox = { console, TextDecoder, Date, Math, JSON, setTimeout };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['_profile-core.js', '_ingest-core.js', '_generator-core.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'api', f), 'utf8'),
                  sandbox, { filename: f });
const M = sandbox.MOMENTUM;

const profile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'p20.json'), 'utf8'));
const TRUTH = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'mining-ground-truth.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name + (detail ? '  · ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  · ' + detail : '')); }
};
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= Math.abs(b) * tol;

const STATE = 'OHT Truck Payload State-Communication Gateway #2';
const PAY   = 'Truck Payload-Communication Gateway #2';
const G = M.Generator.create(profile,
  { seed: 'mineria-2026', stateColumn: STATE, cycleMeasure: PAY });
const t0 = Date.parse(profile.time.startISO), t1 = Date.parse(profile.time.endISO);

console.log('\nPhase 4 · mining ground truth and the striding seam\n');

/* ── 1 · the ground-truth record carries its own provenance ──────────────── */
console.log('1 · ground truth is a record, not a literal');
ok('record declares its schema', TRUTH.schema === 'momentum/mining-ground-truth@1', TRUTH.schema);
ok('record names the workbook that produced it',
   TRUTH.source && TRUTH.source.md5 === '399c213d879c0508cc7d47ef491dbe96',
   TRUTH.source && TRUTH.source.md5);
ok('record is reconstructible, not transcribed',
   /harness\/mining-truth\.js/.test(TRUTH.generatedBy || ''), TRUTH.generatedBy);
ok('record states its method rather than assuming it', !!(TRUTH.method && TRUTH.method.gallons));
ok('numerator was derived at full fidelity',
   TRUTH.method.fullFidelity === true && TRUTH.method.strideSampled === false);
ok('per-unit operands present for all ten trucks',
   Array.isArray(TRUTH.units) && TRUTH.units.length === 10, (TRUTH.units || []).length + ' units');
ok('per-unit operands sum to the fleet gallons',
   near(TRUTH.units.reduce((a, u) => a + u.gallons, 0), TRUTH.fleet.gallons, 1e-6));
ok('per-unit operands sum to the fleet tons',
   near(TRUTH.units.reduce((a, u) => a + u.tons, 0), TRUTH.fleet.tons, 1e-6));
ok('per-unit dumps sum to the fleet dumps',
   TRUTH.units.reduce((a, u) => a + u.dumps, 0) === TRUTH.fleet.dumps, TRUTH.fleet.dumps + ' dumps');

/* the locked figure itself */
ok('fleet gallons are the workbook figure', near(TRUTH.fleet.gallons, 19644.7, 1e-4),
   TRUTH.fleet.gallons + ' gal');
ok('fleet tons are the workbook figure', near(TRUTH.fleet.tons, 123867.3, 1e-6),
   TRUTH.fleet.tons + ' t');
ok('fleet dumps are the workbook figure', TRUTH.fleet.dumps === 299, TRUTH.fleet.dumps + '');
ok('gal/ton rounds to the locked 0.1586',
   Math.round(TRUTH.fleet.galPerTon * 1e4) / 1e4 === 0.1586, TRUTH.fleet.galPerTon + '');

/* the denominator law, asserted rather than assumed */
ok('gal/ton is total gallons over total tons, not a mean of per-unit ratios',
   near(TRUTH.fleet.galPerTon, TRUTH.fleet.gallons / TRUTH.fleet.tons, 1e-9));
const meanOfRatios = TRUTH.units.reduce((a, u) => a + u.galPerTon, 0) / TRUTH.units.length;
ok('the official figure is NOT the mean of per-unit ratios',
   Math.abs(TRUTH.fleet.galPerTon - meanOfRatios) > 1e-6,
   'ratio-of-sums ' + TRUTH.fleet.galPerTon.toFixed(6) + ' vs mean-of-ratios ' + meanOfRatios.toFixed(6));
ok('the official figure is never recomputed to exclude a contaminated unit',
   TRUTH.fleetExcludingContaminated &&
   TRUTH.fleetExcludingContaminated.gallons !== TRUTH.fleet.gallons &&
   /never recomputed/.test(TRUTH.fleetExcludingContaminated.note || ''));

/* ── 2 · the phase-alignment definition travels with the number ──────────── */
console.log('\n2 · 299 carries its definition');
ok('record states the phase alignment', TRUTH.definition &&
   TRUTH.definition.phaseAlignment === 'aligned-shift-start', TRUTH.definition.phaseAlignment);
ok('record warns against comparing it to a steady-state count',
   /steady-state/.test(TRUTH.definition.notComparableTo || ''));
const started = TRUTH.units.filter(u => u.stateAtStart === 'Stopped Empty').length;
ok('all ten units begin the window parked and empty', started === 10, started + '/10');
const inFlight = TRUTH.units.filter(u => /Loading|Loaded/.test(u.stateAtEnd || '')).length;
ok('units still carrying an undumped load at the boundary are recorded',
   inFlight >= 5, inFlight + ' units mid-haul at 06:59:59Z');

/* ── 3 · kpi() discloses the step it integrated at (2C) ──────────────────── */
console.log('\n3 · the striding seam is disclosed, not hidden');
const kFull = G.kpi(t0, t1, { stepSec: profile.time.grainSec });
ok('kpi() reports the step it resolved', kFull.stepSec != null, 'stepSec=' + kFull.stepSec);
ok('kpi() reports the grain it was measured against', kFull.grainSec === profile.time.grainSec,
   'grainSec=' + kFull.grainSec);
ok('an explicit full-grain step reports fullFidelity', kFull.fullFidelity === true);
ok('kpi() distinguishes the step requested from the step used',
   kFull.stepRequested === profile.time.grainSec);

const kAuto = G.kpi(t0, t1, {});
ok('an unrequested step still reports the step actually used', kAuto.stepSec != null,
   'autoStep resolved to ' + kAuto.stepSec + ' s');
ok('an unrequested step is NOT reported as full fidelity', kAuto.fullFidelity === false,
   'stepSec ' + kAuto.stepSec + ' vs grain ' + kAuto.grainSec);
ok('an unrequested step records that nothing was requested', kAuto.stepRequested === null);
ok('autoStep does coarsen a day-long window rather than defaulting to grain',
   kAuto.stepSec > profile.time.grainSec,
   'a KPI taken without an explicit step is an estimate at ' + kAuto.stepSec + ' s');

const kCoarse = G.kpi(t0, t1, { stepSec: 300 });
ok('a coarse explicit step is also refused full-fidelity standing',
   kCoarse.fullFidelity === false && kCoarse.stepSec === 300);
ok('the striding seam is small here but real, and measurable BECAUSE it is disclosed',
   Math.abs(kCoarse.value - kFull.value) / kFull.value < 0.05 &&
   kCoarse.stepSec !== kFull.stepSec,
   'stride 300 vs 1 moves gal/ton by ' +
   (Math.abs(kCoarse.value - kFull.value) / kFull.value * 100).toFixed(3) + '%');

/* ── 4 · targets are separated by role, never by value (3C) ──────────────── */
console.log('\n4 · targets are aspirations and say so');
ok('targets live in their own structure', !!TRUTH.targets);
ok('targets declare they are not measurements',
   /not measurements/i.test(TRUTH.targets.note || ''));
ok('the measured fleet figure is not stored as a target',
   TRUTH.targets.improve5pct !== TRUTH.fleet.galPerTon &&
   TRUTH.targets.improve10pct !== TRUTH.fleet.galPerTon);
ok('no target field appears in the fleet measurement structure',
   !('improve5pct' in TRUTH.fleet) && !('improve10pct' in TRUTH.fleet) &&
   !('target' in TRUTH.fleet));
ok('no measurement field appears in the targets structure',
   !('gallons' in TRUTH.targets) && !('tons' in TRUTH.targets) && !('dumps' in TRUTH.targets));

/* attainment is computed FROM a target, never a target FROM data */
const attain = (target, measured) => (target - measured) / target;
const a5 = attain(TRUTH.targets.improve5pct, TRUTH.fleet.galPerTon);
ok('attainment against a lower-is-better target is signed, not absolute',
   a5 < 0, 'fleet 0.1586 has NOT reached the 0.1507 target: ' + (a5 * 100).toFixed(1) + '%');
ok('the 10% target is unattained by every single unit',
   TRUTH.units.every(u => u.galPerTon > TRUTH.targets.improve10pct),
   'best unit ' + Math.min.apply(null, TRUTH.units.map(u => u.galPerTon)).toFixed(4) +
   ' vs target ' + TRUTH.targets.improve10pct);

/* the collision, pinned so it cannot be rediscovered */
console.log('\n5 · the 0.1507 collision is named, not tested away');
const ht7 = TRUTH.units.filter(u => u.unit === 'HT-007')[0];
ok('HT-007 is present in the record', !!ht7);
ok('HT-007 really does measure the 5% target value',
   Math.round(ht7.galPerTon * 1e4) / 1e4 === TRUTH.targets.improve5pct,
   ht7.galPerTon.toFixed(6) + ' rounds to ' + TRUTH.targets.improve5pct);
ok('a value collision between a target and a measurement is PERMITTED',
   Math.round(ht7.galPerTon * 1e4) / 1e4 === TRUTH.targets.improve5pct && !!ht7.contaminated,
   'the collision is real; banning the value would condemn a correct measurement');
ok('HT-007 is flagged contaminated', ht7.contaminated === true);
ok('the contamination reason is stated, not merely asserted',
   /overload/i.test(ht7.contaminationReason || ''), ht7.contaminationReason);
ok('the record warns that the favourable ratio comes from a fault',
   /fault/i.test(TRUTH.targets.hazard || '') && /0\.1507/.test(TRUTH.targets.hazard || ''));
ok('HT-007 reaches the target by an inflated denominator, not a smaller numerator',
   ht7.tons === Math.max.apply(null, TRUTH.units.map(u => u.tons)) &&
   ht7.gallons > TRUTH.fleet.gallons / TRUTH.units.length,
   'highest tonnage in the fleet (' + ht7.tons + ' t) on above-mean fuel');
ok('no OTHER unit is silently carrying the same hazard',
   TRUTH.units.filter(u => u.contaminated).length === 1);

/* ── 5 · the phase offset, asserted per side (4b) ────────────────────────── */
console.log('\n6 · the generator and the workbook are measured against themselves');
/* Reuse the full-fidelity KPI from section 3 rather than recomputing it: a
   1 s step over an 86,399 s span is ~10 s of work and the value is identical. */
const kGen = kFull;
const genPerCycle = kGen.perCycle;
ok('per-cycle payload matches the workbook — the physics is reproduced',
   near(genPerCycle, TRUTH.fleet.tonsPerCycle, 0.005),
   genPerCycle.toFixed(3) + ' t vs workbook ' + TRUTH.fleet.tonsPerCycle + ' t');
const spanSec = (t1 - t0) / 1000;
const predicted = spanSec / G.plan.cycleSec * G.units().length;
ok('the generator counts what uniform random phase predicts',
   near(kGen.cycles, predicted, 0.01),
   kGen.cycles + ' cycles vs span/cycleSec×units = ' + predicted.toFixed(1));
ok('the workbook count is NOT what the generator is expected to reproduce',
   kGen.cycles !== TRUTH.fleet.dumps,
   'generator ' + kGen.cycles + ' (steady state) vs workbook ' + TRUTH.fleet.dumps + ' (shift start)');
ok('the offset is in the cycle COUNT, not the cycle physics',
   Math.abs(genPerCycle / TRUTH.fleet.tonsPerCycle - 1) <
   Math.abs(kGen.cycles / TRUTH.fleet.dumps - 1),
   'payload differs by ' +
   (Math.abs(genPerCycle / TRUTH.fleet.tonsPerCycle - 1) * 100).toFixed(3) +
   '% while count differs by ' +
   (Math.abs(kGen.cycles / TRUTH.fleet.dumps - 1) * 100).toFixed(2) + '%');
ok('the generator does not put its units in lockstep',
   new Set(G.units().map(u => G.locate(t0, u).state)).size > 1,
   'units occupy ' + new Set(G.units().map(u => G.locate(t0, u).state)).size + ' distinct states at t0');
ok('the workbook DOES start in lockstep — which is the whole difference',
   started === 10);

/* Flush to the margin, matching all seventeen other suites. An indented
   total defeats any margin-anchored count and reports 832 in 17 — which is
   exactly the signature of a suite that never ran. The developer nearly filed
   this as a package failure in session 9. Advice to count suites is worthless
   if the output format defeats the count. */
console.log('\n' + pass + ' passed · ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
