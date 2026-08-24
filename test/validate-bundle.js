/* Validates a complete three-document bundle — the mode the validator exists
 * for. Reads the .docx journey table through the same tables-only path the
 * app uses, the .xlsx data doc, and the .csv config doc.
 *
 *   node test/validate-bundle.js cafe
 *   node test/validate-bundle.js mining
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const V = require('../api/_validate-core.js');

const DIR = process.env.DELIVER || '/home/claude/s1/deliver';
const which = process.argv[2] || 'cafe';

/* .docx tables-only reader — mirrors api/_officedoc-core.js */
function readDocxTable(file) {
  const { execSync } = require('child_process');
  const xml = execSync(`unzip -p "${file}" word/document.xml`, { maxBuffer: 1 << 28 }).toString();
  const tbl = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/);
  if (!tbl) return { rows: [], cols: [] };
  const trs = tbl[0].match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) || [];
  const grid = trs.map(tr =>
    (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(tc =>
      (tc.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
        .map(t => t.replace(/<[^>]+>/g, '')).join('').trim()));
  if (!grid.length) return { rows: [], cols: [] };
  const cols = grid[0];
  const rows = grid.slice(1).map(cells => {
    const o = {};
    cols.forEach((c, i) => { o[c] = cells[i] || ''; });
    return o;
  });
  return { rows, cols };
}

async function readSheet(file, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
  const cols = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, c => cols.push(String(c.value || '').trim()));
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    cols.forEach((c, i) => {
      const v = row.getCell(i + 1).value;
      o[c] = v == null ? '' : String(v.text || v).trim();
    });
    rows.push(o);
  });
  return { rows, cols };
}

function splitRow(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}
function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const cols = splitRow(lines[0]).map(h => h.trim());
  const rows = lines.slice(1).map(l => {
    const cells = splitRow(l); const o = {};
    cols.forEach((c, i) => { o[c] = (cells[i] || '').trim(); });
    return o;
  });
  return { rows, cols };
}

(async () => {
  const map = {
    cafe: {
      journey: 'EXAMPLE-cafe-journey-doc.docx',
      data: ['EXAMPLE-cafe-data-doc.xlsx', 'seeded'],
      config: 'EXAMPLE-cafe-config-doc.csv',
    },
    mining: {
      journey: 'EXAMPLE-mining-journey-doc.docx',
      data: ['EXAMPLE-mining-data-doc.xlsx', 'replay'],
      config: null,
    },
  }[which];

  const bundle = {};
  bundle.journey = readDocxTable(path.join(DIR, map.journey));
  bundle.data = await readSheet(path.join(DIR, map.data[0]), map.data[1]);
  if (map.config) bundle.config = readCsv(path.join(DIR, map.config));

  console.log('\nBUNDLE \u00b7 ' + which);
  console.log('  journey rows ' + bundle.journey.rows.length +
              '   data rows ' + bundle.data.rows.length +
              '   config rows ' + (bundle.config ? bundle.config.rows.length : 0));

  const res = V.validate(bundle);
  const c = res.counts;
  console.log('  rejects ' + c.rejects + '   warnings ' + c.warnings + '\n');
  res.items.forEach(i => {
    const tag = i.level === 'reject' ? 'REJECT' : 'warn  ';
    console.log('  ' + tag + ' [' + i.code + '] ' + i.doc + ' \u00b7 ' + i.subject);
    console.log('         ' + i.message + (i.detail ? '  \u2014 ' + i.detail : ''));
  });
  if (!res.items.length) console.log('  clean');
  console.log('');
  process.exit(c.rejects ? 1 : 0);
})();
