/* build/engine.js — static/engine/index.html → public/engine/index.html

   The /engine demo is a build received as a finished file, older than
   src/boot.js, so on a deployed host BOBee had no route to /api/bobby. This
   copies it into the output with the same boot script the main build injects,
   placed first in <head>. The file in static/ stays exactly as received; only
   the served copy gains the script.

   Side effect, accepted for the demo: the boot line also switches on the heavy
   ingest path, and this build predates the worker fallback, so a data file
   above 8 MB fails while Supabase is not configured for the deployment. */
'use strict';
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'static', 'engine', 'index.html');
const out = path.join(ROOT, 'public', 'engine', 'index.html');

let html = fs.readFileSync(src, 'utf8');
if (html.indexOf('id="mom-boot"') >= 0) throw new Error('engine build already carries mom-boot');
if (html.split('<head>').length !== 2) throw new Error('expected exactly one <head> in ' + src);

const boot = fs.readFileSync(path.join(ROOT, 'src', 'boot.js'), 'utf8').trim();
html = html.replace('<head>', '<head>\n<script id="mom-boot">\n' + boot + '\n</script>');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('public/engine/index.html · ' + (html.length / 1048576).toFixed(2) + ' MB · mom-boot injected');
