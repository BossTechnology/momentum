/* build/extract.js — run ONCE to reconcile.
   Splits the current single-file build into src/shell.html plus api/ modules.
   Where an HTML block and its api/ file differ it reports the direction and
   takes the HTML as truth, because the HTML is what has been passing 407
   assertions. Nothing is replaced without printing what changed. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const MAP = require('./modules.json');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: node build/extract.js <momentum-Simulation_NN.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const h = function (s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 10); };
const rows = [];

Object.keys(MAP).forEach(function (file) {
  const id = MAP[file];
  const re = new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>');
  const m = html.match(re);
  if (!m) { rows.push([file, 'NO BLOCK IN HTML']); return; }
  const inHtml = m[1].replace(/\r\n/g, '\n').trim();
  const apiPath = path.join(ROOT, 'api', file);
  const inApi = fs.existsSync(apiPath)
    ? fs.readFileSync(apiPath, 'utf8').replace(/\r\n/g, '\n').trim() : null;
  let state;
  if (inApi == null) state = 'new file, taken from HTML';
  else if (h(inApi) === h(inHtml)) state = 'identical';
  else state = 'DIFFERED — html ' + inHtml.split('\n').length + ' vs api ' +
               inApi.split('\n').length + ' lines · HTML kept';
  fs.writeFileSync(apiPath, inHtml + '\n');
  rows.push([file, state]);
  html = html.replace(re, '<!--mom:inject ' + id + '-->');
});

fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
if (html.indexOf('<!--mom:boot-->') < 0) html = html.replace('</head>', '<!--mom:boot-->\n</head>');
fs.writeFileSync(path.join(ROOT, 'src', 'shell.html'), html);

console.log('module'.padEnd(30) + 'state');
console.log('-'.repeat(74));
rows.forEach(function (r) { console.log(r[0].padEnd(30) + r[1]); });
console.log('\nsrc/shell.html written · ' + rows.length + ' slots');
