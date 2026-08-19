/* ═══════════════════════════════════════════════════════════════════════════
   harness/gen-synthetic-workbook.js — a stand-in for the mining workbook

   The 84 MB mining workbook is not in this repo and cannot be, so the heavy
   ingest path had no way to be exercised at size: the global file size limit,
   the single PUT, the ZIP-over-ranges reader, memory and the 300 s ceiling all
   went untested until someone happened to have the real file.

   This writes a workbook of the same shape and size out of nothing. It proves
   every mechanic except the figures — the profile it produces is synthetic, so
   it cannot verify that the server profile matches the in-page one (checklist
   row 14). Everything before that row, it can.

   It found a real defect the first time it ran: an 84.4 MB upload was rejected
   with a 413 because the global Storage limit had been set to exactly 84 MB.
   The real workbook is the same nominal size and would have hit it too.

   No dependencies. The ZIP container is written directly with zlib, which is
   also how api/_ingest-core.js reads one back.

     node harness/gen-synthetic-workbook.js --mb 84 --out /tmp/synthetic.xlsx
     node harness/profile-local.js /tmp/synthetic.xlsx    # verify it parses

   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs'), zlib = require('zlib'), path = require('path');

/* ── a minimal ZIP writer ────────────────────────────────────────────────── */
// Entries are deflated one at a time and streamed out, so peak memory is one
// sheet rather than the whole archive. No ZIP64: the largest entry here is
// ~31 MB and the archive stays far below 4 GB.
function ZipWriter(outPath) {
  const fd = fs.openSync(outPath, 'w');
  const central = [];
  let offset = 0;

  const w = buf => { fs.writeSync(fd, buf); offset += buf.length; };

  this.add = function (name, contentBuf) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(contentBuf);
    const deflated = zlib.deflateRawSync(contentBuf, { level: 6 });
    const localOffset = offset;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);   // local file header signature
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(0, 6);            // flags
    lh.writeUInt16LE(8, 8);            // method: deflate
    lh.writeUInt16LE(0, 10);           // mod time
    lh.writeUInt16LE(0x0021, 12);      // mod date (1980-01-01)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(deflated.length, 18);
    lh.writeUInt32LE(contentBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    w(lh); w(nameBuf); w(deflated);

    central.push({ name: nameBuf, crc, csize: deflated.length,
                   usize: contentBuf.length, localOffset });
  };

  this.close = function () {
    const cdOffset = offset;
    for (const e of central) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0); // central directory signature
      cd.writeUInt16LE(20, 4);         // version made by
      cd.writeUInt16LE(20, 6);         // version needed
      cd.writeUInt16LE(0, 8);
      cd.writeUInt16LE(8, 10);
      cd.writeUInt16LE(0, 12);
      cd.writeUInt16LE(0x0021, 14);
      cd.writeUInt32LE(e.crc, 16);
      cd.writeUInt32LE(e.csize, 20);
      cd.writeUInt32LE(e.usize, 24);
      cd.writeUInt16LE(e.name.length, 28);
      cd.writeUInt16LE(0, 30);         // extra
      cd.writeUInt16LE(0, 32);         // comment
      cd.writeUInt16LE(0, 34);         // disk
      cd.writeUInt16LE(0, 36);         // internal attrs
      cd.writeUInt32LE(0, 38);         // external attrs
      cd.writeUInt32LE(e.localOffset, 42);
      w(cd); w(e.name);
    }
    const cdSize = offset - cdOffset;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);
    w(eocd);
    fs.closeSync(fd);
    return offset;
  };
}

/* ── the workbook itself ─────────────────────────────────────────────────── */
// Columns mirror the mining telemetry: a per-second timestamp, the truck, its
// state, and continuous measures. Values are pseudo-random so they compress
// about as poorly as real telemetry — a file of repeated values would deflate
// to a fraction of the size and prove nothing about the size limit.
const COLS = ['Timestamp', 'Truck', 'State', 'Truck Payload-Communication Gateway #2',
              'Fuel Consumption Rate-Engine', 'Engine Speed-Engine', 'Idle Hours',
              'Haul Distance', 'Ambient Temp', 'Gateway Latency'];
const TRUCKS = Array.from({ length: 10 }, (_, i) => `OHT-${String(i + 1).padStart(2, '0')}`);
const STATES = ['Hauling', 'Loading', 'Dumping', 'Idle', 'Queue', 'Travel', 'Spotting'];
const SHARED = [...COLS, ...TRUCKS, ...STATES];
const sIdx = v => SHARED.indexOf(v);

// deterministic PRNG so a regenerated file is byte-identical
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
}
const col = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };

function sheetXml(rows, seed) {
  const r = rng(seed);
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  out.push('<row r="1">' + COLS.map((c, i) =>
    `<c r="${col(i)}1" t="s"><v>${sIdx(c)}</v></c>`).join('') + '</row>');
  const num = (v, d) => v.toFixed(d);
  for (let i = 1; i <= rows; i++) {
    const n = i + 1;
    out.push(`<row r="${n}">` +
      `<c r="A${n}"><v>${num(45000 + i / 86400, 8)}</v></c>` +
      `<c r="B${n}" t="s"><v>${sIdx(TRUCKS[i % 10])}</v></c>` +
      `<c r="C${n}" t="s"><v>${sIdx(STATES[i % 7])}</v></c>` +
      `<c r="D${n}"><v>${num(180 + r() * 60, 4)}</v></c>` +
      `<c r="E${n}"><v>${num(0.09 + r() * 0.13, 6)}</v></c>` +
      `<c r="F${n}"><v>${num(700 + r() * 1400, 3)}</v></c>` +
      `<c r="G${n}"><v>${num(r() * 4, 5)}</v></c>` +
      `<c r="H${n}"><v>${num(r() * 12.5, 4)}</v></c>` +
      `<c r="I${n}"><v>${num(-5 + r() * 43, 3)}</v></c>` +
      `<c r="J${n}"><v>${num(10 + r() * 390, 2)}</v></c>` +
      '</row>');
  }
  out.push('</sheetData></worksheet>');
  return Buffer.from(out.join(''), 'utf8');
}

function build({ targetMb, sheets, out }) {
  // one small sheet first, to learn compressed bytes per row
  const probeRows = 5000;
  const probe = zlib.deflateRawSync(sheetXml(probeRows, 1), { level: 6 }).length;
  const perRow = probe / probeRows;
  const rowsPerSheet = Math.max(1, Math.round((targetMb * 1024 * 1024) / perRow / sheets));

  console.log(`calibrated at ${perRow.toFixed(1)} compressed bytes/row · ` +
              `${rowsPerSheet.toLocaleString()} rows × ${sheets} sheets`);

  const zip = new ZipWriter(out);
  const names = Array.from({ length: sheets }, (_, i) => `Telemetry_${i + 1}`);

  zip.add('[Content_Types].xml',
    Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>', 'utf8'));

  zip.add('_rels/.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>', 'utf8'));

  zip.add('xl/workbook.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>', 'utf8'));

  zip.add('xl/_rels/workbook.xml.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>` +
    `<Relationship Id="rId${sheets + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>', 'utf8'));

  zip.add('xl/sharedStrings.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${SHARED.length}" uniqueCount="${SHARED.length}">` +
    SHARED.map(s => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('') +
    '</sst>', 'utf8'));

  zip.add('xl/styles.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="0"/><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs>' +
    '</styleSheet>', 'utf8'));

  for (let i = 0; i < sheets; i++) {
    zip.add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(rowsPerSheet, i + 1));
    process.stdout.write(`\r  sheet ${i + 1}/${sheets}`);
  }
  process.stdout.write('\r');
  const size = zip.close();
  return { size, rows: rowsPerSheet * sheets };
}

if (require.main === module) {
  const arg = (flag, dflt) => {
    const i = process.argv.indexOf(flag);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
  };
  const targetMb = Number(arg('--mb', 84));
  const sheets = Number(arg('--sheets', 16));
  const out = path.resolve(arg('--out', 'synthetic-workbook.xlsx'));
  const t0 = Date.now();
  const { size, rows } = build({ targetMb, sheets, out });
  console.log(`${out}\n${size.toLocaleString()} bytes · ${(size / 1024 / 1024).toFixed(1)} MB · ` +
              `${rows.toLocaleString()} rows · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

module.exports = { build };
