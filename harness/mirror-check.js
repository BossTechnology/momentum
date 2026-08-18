/* harness/mirror-check.js — is every api/ module actually in the build?
   An edit left unmirrored does nothing at all in the browser. This compares
   each api/ file against the <script id="mom-*"> block that carries it. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'momentum-Simulation_68.html'), 'utf8');

const MAP = {
  '_profile-core.js': 'mom-core-profile',
  '_ingest-core.js': 'mom-core-ingest',
  '_generator-core.js': 'mom-core-generator',
  '_risk-core.js': 'mom-core-risk',
  '_answer-core.js': 'mom-answer-core',
  '_channels-core.js': 'mom-channels-core',
  '_risklog-core.js': 'mom-risklog-core',
  '_configdoc-core.js': 'mom-configdoc-core',
  '_configapply-core.js': 'mom-configapply-core',
  '_configtemplate-core.js': 'mom-configtemplate-core',
  '_officedoc-core.js': 'mom-officedoc-core',
  'phase16-anomalies-ui.js': 'mom-anomalies-ui',
  'phase17-header.js': 'mom-header-global',
  'phase7-answer-ui.js': 'mom-phase7-ui',
  'phase9-channels-ui.js': 'mom-channels-ui',
};

function block(id) {
  const re = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>');
  const m = html.match(re);
  return m ? m[1] : null;
}
const norm = s => s.replace(/\r\n/g, '\n').trim();
const h = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

console.log('module                          api    build   state');
console.log('─────────────────────────────────────────────────────────────');
let drift = [];
Object.keys(MAP).forEach(f => {
  const src = norm(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8'));
  const b = block(MAP[f]);
  const al = src.split('\n').length;
  if (b == null) {
    console.log(f.padEnd(30) + String(al).padStart(5) + '      —   NOT IN BUILD');
    drift.push(f + ' (absent)');
    return;
  }
  const bn = norm(b), bl = bn.split('\n').length;
  const same = h(src) === h(bn);
  console.log(f.padEnd(30) + String(al).padStart(5) + String(bl).padStart(7) + '   ' +
    (same ? 'mirrored' : 'DRIFTED  (' + (al - bl) + ' lines behind)'));
  if (!same) drift.push(f + ' (' + (al - bl) + ')');
});
console.log('\n' + (drift.length ? drift.length + ' drifted: ' + drift.join(', ') : 'all mirrored'));
