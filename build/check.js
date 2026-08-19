/* build/check.js — the gate that makes drift impossible to merge.
   Rebuilds from api/ and compares against a reference build. Any difference
   means someone edited generated output instead of a module. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const build = require('./build');
const ref = process.argv[2];
const fresh = build();
const h = function (s) { return crypto.createHash('sha1').update(s.replace(/\r\n/g, '\n')).digest('hex'); };

// With no reference path, compare against the hash pinned in reference.json.
// Pinning the hash rather than a 1.19 MB copy of the output keeps the gate in
// the repo without committing generated content.
if (!ref) {
  const pin = require('./reference.json');
  const got = h(fresh);
  if (got === pin.sha1) { console.log('IDENTICAL to reference.json · ' + fresh.length + ' bytes'); process.exit(0); }
  console.error('DRIFT: rebuild differs from build/reference.json');
  console.error('  expected  sha1 ' + pin.sha1 + ' · ' + pin.bytes + ' bytes');
  console.error('  rebuilt   sha1 ' + got + ' · ' + fresh.length + ' bytes');
  console.error('If the change was intended, update build/reference.json in the same commit.');
  process.exit(1);
}
const old = fs.readFileSync(ref, 'utf8');
if (h(old) === h(fresh)) { console.log('IDENTICAL to ' + path.basename(ref)); process.exit(0); }
console.error('DRIFT: rebuild differs from ' + path.basename(ref) +
  ' (committed ' + old.length + ' / rebuilt ' + fresh.length + ' bytes)');
process.exit(1);
