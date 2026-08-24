/* Runs the validator over every bundled Config Doc and prints one report.
 *
 * Config-only mode: no journey doc and no data doc are attached, so the
 * cross-document checks stay quiet and what surfaces is what each file says
 * about ITSELF. That is deliberately the weakest possible reading — anything
 * this finds is wrong on the file's own terms, with nothing to disagree with.
 *
 *   node test/validate-report.js            summary table
 *   node test/validate-report.js --detail   every finding
 *   node test/validate-report.js mining     one industry, detailed
 */
const fs = require('fs');
const path = require('path');
const V = require('../api/_validate-core.js');

const HEADER = 'kind,kbr,name,unit,format,direction,target,notes,dimension,measure,' +
               'denominator,aggregation,rank,op,value,response,channels,dna,weight,' +
               'rollup,persistencesec';
const COLS = HEADER.split(',');

/* the CSV these files use: quoted fields may contain commas */
function splitRow(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseConfig(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { rows: [], cols: COLS };
  const head = splitRow(lines[0]).map(h => h.trim());
  const cols = head[0].toLowerCase() === 'kind' ? head : COLS;
  const body = head[0].toLowerCase() === 'kind' ? lines.slice(1) : lines;
  const rows = body.map(l => {
    const cells = splitRow(l);
    const o = {};
    cols.forEach((c, i) => { o[c] = (cells[i] || '').trim(); });
    return o;
  });
  return { rows, cols };
}

const dir = path.join(__dirname, '..', 'config');
const files = fs.readdirSync(dir).filter(f => /\.csv$/.test(f)).sort();

const only = process.argv.slice(2).find(a => !a.startsWith('--'));
const detail = process.argv.includes('--detail') || !!only;

const rows = [];
let grandR = 0, grandW = 0;
const codeTally = {};

for (const f of files) {
  const name = f.replace(/-demo-config\.csv|-config\.csv/, '');
  if (only && name !== only) continue;

  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  const config = parseConfig(text);
  const res = V.validate({ config });

  grandR += res.counts.rejects;
  grandW += res.counts.warnings;
  res.items.forEach(i => { codeTally[i.code] = (codeTally[i.code] || 0) + 1; });

  const kbrs = res.config.kbrs.length;
  const ans = res.config.answers.length;
  const risk = res.config.risks.length;
  rows.push({ name, kbrs, ans, risk,
              r: res.counts.rejects, w: res.counts.warnings });

  if (detail && res.items.length) {
    console.log('\n\u2500\u2500 ' + name);
    res.items.forEach(i => {
      const tag = i.level === 'reject' ? 'REJECT' : 'warn  ';
      console.log('   ' + tag + '  [' + i.code + ']  ' + i.subject);
      console.log('           ' + i.message + (i.detail ? '  \u2014 ' + i.detail : ''));
    });
  }
}

if (!only) {
  console.log('\nBUNDLED CONFIG DOCS \u00b7 validator report (config-only mode)\n');
  console.log('  ' + 'industry'.padEnd(16) + 'kbrs  answers  risk   reject  warn');
  console.log('  ' + '\u2500'.repeat(56));
  rows.forEach(r => {
    console.log('  ' + r.name.padEnd(16) +
                String(r.kbrs).padStart(4) +
                String(r.ans).padStart(9) +
                String(r.risk).padStart(6) +
                String(r.r).padStart(8) +
                String(r.w).padStart(6));
  });
  console.log('  ' + '\u2500'.repeat(56));
  console.log('  ' + 'total'.padEnd(16) + ''.padStart(19) +
              String(grandR).padStart(8) + String(grandW).padStart(6));

  console.log('\n  findings by code');
  Object.keys(codeTally).sort((a, b) => codeTally[b] - codeTally[a])
    .forEach(c => console.log('    ' + c.padEnd(16) + String(codeTally[c]).padStart(4)));
  console.log('');
}
