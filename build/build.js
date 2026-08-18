/* build/build.js — index.html is GENERATED, never hand-edited.
   Every <script id="mom-*"> block is injected verbatim from api/. That is the
   mirroring law expressed as a build step instead of a discipline: an edit to
   api/ cannot fail to reach the browser, because the browser file does not
   exist until this runs. */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MAP = require('./modules.json');

function build() {
  let html = fs.readFileSync(path.join(ROOT, 'src', 'shell.html'), 'utf8');
  const missing = [];
  Object.keys(MAP).forEach(function (file) {
    const id = MAP[file];
    const src = fs.readFileSync(path.join(ROOT, 'api', file), 'utf8').replace(/\r\n/g, '\n').trim();
    const marker = '<!--mom:inject ' + id + '-->';
    if (html.indexOf(marker) < 0) { missing.push(id); return; }
    html = html.replace(marker, '<script id="' + id + '">\n' + src + '\n</script>');
  });
  if (missing.length) throw new Error('shell.html has no slot for: ' + missing.join(', '));
  const left = html.match(/<!--mom:inject [^>]*-->/g);
  if (left) throw new Error('unfilled slots: ' + left.join(', '));

  const bootPath = path.join(ROOT, 'src', 'boot.js');
  if (fs.existsSync(bootPath) && html.indexOf('<!--mom:boot-->') >= 0) {
    html = html.replace('<!--mom:boot-->',
      '<script id="mom-boot">\n' + fs.readFileSync(bootPath, 'utf8').trim() + '\n</script>');
  }
  const out = path.join(ROOT, 'public');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), html);
  return html;
}
if (require.main === module) {
  const h = build();
  console.log('public/index.html · ' + (h.length / 1048576).toFixed(2) + ' MB · ' +
    Object.keys(MAP).length + ' modules inlined');
}
module.exports = build;
