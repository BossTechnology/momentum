/* ═══════════════════════════════════════════════════════════════════════════
   harness/mining-truth.js — derive the mining ground truth FROM the workbook

   Phase 4, decision 1D. The gate cannot recompute this: the workbook is 84 MB
   and is not in the repo. So the figures are pinned. The point of this script
   is that the pin is RECONSTRUCTIBLE rather than asserted — anyone holding the
   workbook can regenerate test/fixtures/mining-ground-truth.json and get the
   same bytes, and the record says which workbook produced it.

   A bare literal 0.1586 in a test file is a note. The denominator law says
   ground truth comes from the workbook and never from notes, so the literal
   has to carry its provenance or it is not ground truth at all.

   Everything downstream of the file read is the SHIPPED ingest core, required
   verbatim through vm — there is no second parser here to disagree with the
   product.

   METHOD, stated because the numbers are meaningless without it:
     gallons   Fuel Consumption Rate-Engine is gal/h sampled once per second.
               Integrated at FULL FIDELITY: every row, sum(rate)/3600.
               No striding. Generator.aggregate() would stride by default via
               autoStep(); nothing here goes through it.
     dumps     A transition INTO the 'Dumping' state. Counted once per entry.
     tons      Peak payload observed across the loaded phase, banked at the
               moment the truck enters 'Dumping'. Payload reads 0 at that
               instant, so sampling payload AT the transition yields 0.0 t
               fleet-wide — the peak is what was hauled and dumped.

   PHASE ALIGNMENT — read this before comparing 299 to anything.
     The workbook is a SHIFT: all ten trucks sit at 'Stopped Empty' at
     07:00:00Z, and seven still carry an undumped load at 06:59:59Z. So the
     window pays a full head cost (~3,585 s before the first dump) and gets no
     compensating head gain. 299 is "dumps completed by a fleet that began the
     window parked and empty", NOT "dumps in an arbitrary 24 h window" — the
     latter is ~307 and the Generator, which gives each unit a uniform random
     phase, correctly produces ~303. Those are different quantities. Comparing
     them without saying so manufactures a defect that does not exist.

   Usage:  node harness/mining-truth.js path/to/workbook.xlsx [--out FILE]
           Refuses on md5 mismatch rather than deriving from a different file.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'),
      zlib = require('zlib'), crypto = require('crypto');

const EXPECT_MD5 = '399c213d879c0508cc7d47ef491dbe96';
const SOURCE_NAME = 'Simulacion_flota_10_camiones_24h_por_segundo.xlsx';

/* HT-007 carries the injected case "Sobrecarga recurrente" (recurrent
   overload). Its tonnage is inflated by the fault, which is why its gal/ton is
   the fleet best. The control sheet marks it "excluir del entrenamiento".
   Flagged in the record so nobody reads it as the efficiency leader. */
const CONTAMINATED = {
  'HT-007': 'Sobrecarga recurrente — injected overload inflates tonnage; ' +
            'its favourable gal/ton comes from a fault, not efficiency'
};

const FILE = process.argv[2];
if (!FILE) { console.error('usage: node harness/mining-truth.js <workbook.xlsx> [--out FILE]'); process.exit(2); }
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > -1 ? process.argv[outIdx + 1]
                        : path.join(__dirname, '..', 'test', 'fixtures', 'mining-ground-truth.json');

/* ── 1 · provenance before anything is read ──────────────────────────────── */
function md5File(f) {
  const h = crypto.createHash('md5');
  const fd = fs.openSync(f, 'r'), buf = Buffer.alloc(1 << 20);
  let pos = 0, n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) { h.update(buf.subarray(0, n)); pos += n; }
  fs.closeSync(fd);
  return h.digest('hex');
}
const md5 = md5File(FILE);
console.log('workbook   :', path.basename(FILE));
console.log('md5        :', md5);
if (md5 !== EXPECT_MD5) {
  console.error('\nREFUSED: md5 does not match the registered mining workbook.');
  console.error('  expected ' + EXPECT_MD5);
  console.error('  got      ' + md5);
  console.error('Deriving ground truth from an unverified file would produce a precise');
  console.error('number with an unknown source. Supply the registered workbook, or');
  console.error('update EXPECT_MD5 deliberately if the source has genuinely changed.');
  process.exit(1);
}
console.log('provenance : OK — matches the registered workbook\n');

/* ── 2 · the shipped ingest core, verbatim ───────────────────────────────── */
const sandbox = { console, Math, Date, JSON, RegExp, Error, isFinite, isNaN, parseFloat, parseInt,
  String, Number, Boolean, Array, Object, Map, Set, TextDecoder, Uint8Array, ArrayBuffer,
  DataView, Buffer, MOMENTUM: {}, setTimeout, Promise };
sandbox.window = sandbox; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'api', '_ingest-core.js'), 'utf8'),
                sandbox, { filename: '_ingest-core.js' });
const I = sandbox.MOMENTUM.Ingest;

const fd = fs.openSync(FILE, 'r'), size = fs.statSync(FILE).size;
const range = (s, l) => { const b = Buffer.alloc(l); fs.readSync(fd, b, 0, l, s); return new Uint8Array(b); };
const eocd = I.zip.findEocd(range(Math.max(0, size - 66000), Math.min(66000, size)));
const entries = I.zip.parseCentralDirectory(range(eocd.cdOffset, eocd.cdSize), eocd.count);
const find = n => entries.find(e => e.name === n);

function inflateEntry(entry) {
  return new Promise((res, rej) => {
    const off = I.zip.dataOffset(range(entry.localHeaderOffset, 64), entry);
    const chunks = [];
    fs.createReadStream(FILE, { start: off, end: off + entry.compressedSize - 1 })
      .pipe(zlib.createInflateRaw())
      .on('data', c => chunks.push(c)).on('end', () => res(Buffer.concat(chunks).toString('utf8')))
      .on('error', rej);
  });
}
function scanEntry(entry, opt) {
  return new Promise((res, rej) => {
    const off = I.zip.dataOffset(range(entry.localHeaderOffset, 64), entry);
    const sc = I.createSheetScanner(opt);
    fs.createReadStream(FILE, { start: off, end: off + entry.compressedSize - 1 })
      .pipe(zlib.createInflateRaw())
      .on('data', c => sc.push(c.toString('utf8')))
      .on('end', () => { if (sc.end) sc.end(); res(); }).on('error', rej);
  });
}

/* Map sheet NAME to its part, rather than trusting sheetN ordering. */
async function sheetIndex() {
  const wb = await inflateEntry(find('xl/workbook.xml'));
  const rels = await inflateEntry(find('xl/_rels/workbook.xml.rels'));
  const relMap = {};
  const relRe = /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = relRe.exec(rels))) relMap[m[1]] = m[2].replace(/^\/?xl\//, '').replace(/^\.\//, '');
  const out = {};
  const shRe = /<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g;
  while ((m = shRe.exec(wb))) out[m[1]] = 'xl/' + relMap[m[2]];
  return out;
}

/* ── 3 · accumulate one truck at full fidelity ───────────────────────────── */
const RATE = 'Fuel Consumption Rate-Engine';
const PAY  = 'Truck Payload';
const STATE = 'OHT Truck Payload State';

async function readTruck(entry, ss, styleIsDate) {
  let cRate = -1, cPay = -1, cState = -1, header = false;
  let rows = 0, rateSum = 0, dumps = 0, tons = 0, peak = 0, prev = null;
  let firstDumpRow = -1, lastDumpRow = -1, firstState = null, lastState = null;

  await scanEntry(entry, { sharedStrings: ss, styleIsDate: styleIsDate, onRow: cells => {
    if (!header) {
      // The header row is the one carrying the time column; four rows of
      // preamble sit above it. Columns resolved by NAME, never by position.
      const hit = cells.findIndex(c => c != null && String(c).trim() === 'Date/Time');
      if (hit === -1) return;
      cells.forEach((c, i) => {
        const s = c == null ? '' : String(c);
        if (s.indexOf(RATE) === 0) cRate = i;
        else if (s.indexOf(PAY) === 0) cPay = i;
        else if (s.indexOf(STATE) === 0) cState = i;
      });
      header = true;
      return;
    }
    if (cells[0] == null) return;
    const rate = Number(cells[cRate]) || 0;
    const pay  = Number(cells[cPay]) || 0;
    const st   = cells[cState] == null ? null : String(cells[cState]);
    if (firstState === null) firstState = st;
    lastState = st;
    rateSum += rate;                       // full fidelity: every row, no stride
    if (pay > peak) peak = pay;
    if (st !== prev) {
      if (st && st.indexOf('Dumping') > -1) {
        dumps++; tons += peak; peak = 0;
        if (firstDumpRow < 0) firstDumpRow = rows;
        lastDumpRow = rows;
      }
      prev = st;
    }
    rows++;
  }});

  if (cRate < 0 || cPay < 0 || cState < 0)
    throw new Error('column resolution failed (rate=' + cRate + ' pay=' + cPay + ' state=' + cState + ')');
  return { rows: rows, gallons: rateSum / 3600, dumps: dumps, tons: tons,
           firstDumpAtSec: firstDumpRow, lastDumpAtSec: lastDumpRow,
           stateAtStart: firstState, stateAtEnd: lastState };
}

/* ── 4 · run ─────────────────────────────────────────────────────────────── */
const r4 = n => Math.round(n * 1e4) / 1e4;
/* Ratios keep full working precision. Rounding galPerTon to 4 dp made the
   record's own ratio stop equalling its own operands — the denominator law
   failing inside the file that states it. Rounding is for display only. */
const r10 = n => Math.round(n * 1e10) / 1e10;

(async () => {
  const t0 = Date.now();
  const ssE = find('xl/sharedStrings.xml');
  const ss = ssE ? I.parseSharedStrings(await inflateEntry(ssE)) : [];
  const stE = find('xl/styles.xml');
  const styleIsDate = stE ? I.parseStyles(await inflateEntry(stE)) : [];
  const idx = await sheetIndex();

  const names = Object.keys(idx).filter(n => /^HT-\d+$/.test(n)).sort();
  if (!names.length) throw new Error('no HT-### telemetry sheets found');

  const units = [];
  let G = 0, T = 0, D = 0, R = 0;
  console.log('unit'.padEnd(8) + 'gal'.padStart(12) + 'tons'.padStart(14) +
              'dumps'.padStart(8) + 'gal/ton'.padStart(11));
  for (const n of names) {
    const e = find(idx[n]);
    if (!e) throw new Error('sheet part missing for ' + n);
    const u = await readTruck(e, ss, styleIsDate);
    const rec = { unit: n, rows: u.rows, gallons: r4(u.gallons), tons: r4(u.tons), dumps: u.dumps,
                  galPerTon: r10(u.gallons / u.tons),
                  firstDumpAtSec: u.firstDumpAtSec, lastDumpAtSec: u.lastDumpAtSec,
                  stateAtStart: u.stateAtStart, stateAtEnd: u.stateAtEnd };
    if (CONTAMINATED[n]) { rec.contaminated = true; rec.contaminationReason = CONTAMINATED[n]; }
    units.push(rec);
    G += u.gallons; T += u.tons; D += u.dumps; R += u.rows;
    console.log(n.padEnd(8) + u.gallons.toFixed(4).padStart(12) +
                u.tons.toFixed(4).padStart(14) + String(u.dumps).padStart(8) +
                (u.gallons / u.tons).toFixed(6).padStart(11) +
                (CONTAMINATED[n] ? '   <- contaminated' : ''));
  }

  const clean = units.filter(u => !u.contaminated);
  const record = {
    schema: 'momentum/mining-ground-truth@1',
    generatedBy: 'harness/mining-truth.js',
    note: 'Derived from the workbook, never transcribed. Regenerate with: ' +
          'node harness/mining-truth.js <workbook.xlsx>',
    source: { name: SOURCE_NAME, md5: EXPECT_MD5, bytes: size,
              sheets: Object.keys(idx).length, telemetrySheets: names.length, rows: R },
    window: { startISO: '2026-08-05T07:00:00Z', endISO: '2026-08-06T06:59:59Z',
              spanSec: 86399, grainSec: 1,
              note: 'The span is 86,399,000 ms and ends at 06:59:59Z — not a round 24 h.' },
    method: {
      gallons: 'Fuel Consumption Rate-Engine (gal/h) integrated at full fidelity: ' +
               'sum(rate) over every 1 s row, divided by 3600. No stride sampling.',
      dumps: "Transitions INTO the 'Dumping' state, counted once per entry.",
      tons: 'Peak payload across each loaded phase, banked on entry to Dumping. ' +
            'Payload reads 0 at that instant, so sampling at the transition yields 0.0 t.',
      fullFidelity: true,
      strideSampled: false
    },
    definition: {
      phaseAlignment: 'aligned-shift-start',
      detail: 'All ten units are Stopped Empty at 07:00:00Z and seven still carry an ' +
              'undumped load at 06:59:59Z. The window therefore pays a full head cost ' +
              'and receives no compensating head gain.',
      dumpsMean: 'Dumps completed by a fleet that BEGAN the window parked and empty.',
      notComparableTo: 'Dumps in an arbitrary steady-state window, which for this ' +
                       'cycle length is ~307 untruncated and ~303 at uniform random ' +
                       'phase. Comparing 299 to a steady-state count without ' +
                       'accounting for phase manufactures a defect that does not exist.'
    },
    fleet: {
      gallons: r4(G), tons: r4(T), dumps: D,
      galPerTon: r10(G / T), galPerTonRounded: r4(G / T),
      tonsPerCycle: r10(T / D)
    },
    units: units,
    fleetExcludingContaminated: {
      units: clean.length,
      gallons: r4(clean.reduce((a, u) => a + u.gallons, 0)),
      tons: r4(clean.reduce((a, u) => a + u.tons, 0)),
      dumps: clean.reduce((a, u) => a + u.dumps, 0),
      note: 'Provided for reference only. The denominator law fixes the official ' +
            'figure as TOTAL fleet gallons over TOTAL tons hauled and dumped. The ' +
            'official gal/ton is fleet.galPerTon and is never recomputed to exclude ' +
            'a unit, however contaminated.'
    },
    targets: {
      note: 'ASPIRATIONS, not measurements. Held here only so that no measurement ' +
            'path can be mistaken for them. Attainment is computed FROM a target ' +
            'against a measurement, never a target derived FROM data.',
      improve5pct: 0.1507,
      improve10pct: 0.1427,
      hazard: 'improve5pct (0.1507) COLLIDES with a real measurement: HT-007 measures ' +
              'exactly 0.1507 in the workbook summary. It reaches it by carrying an ' +
              'injected overload, so its favourable ratio comes from a fault. A value ' +
              'collision is legitimate and must not be tested away; what must never ' +
              'happen is a unit reading as target-achieving on the strength of an ' +
              'inflated denominator.',
      unattainedByAnyUnit: 0.1427
    }
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(record, null, 2) + '\n');

  console.log('\n──────────────────────────────────────────────');
  console.log('fleet gallons  : %s', r4(G));
  console.log('fleet tons     : %s', r4(T));
  console.log('fleet dumps    : %s', D);
  console.log('gal/ton        : %s', (G / T).toFixed(6));
  console.log('tons per cycle : %s', (T / D).toFixed(3));
  console.log('rows read      : %s  (full fidelity, no stride)', R.toLocaleString());
  console.log('elapsed        : %ss', ((Date.now() - t0) / 1000).toFixed(1));
  console.log('written        : %s', OUT);
  fs.closeSync(fd);
})().catch(e => { console.error('FAILED:', e && e.message || e); process.exit(1); });
