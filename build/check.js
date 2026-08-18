/* build/check.js — the gate that makes drift impossible to merge.
   Rebuilds from api/ and compares against a reference build. Any difference
   means someone edited generated output instead of a module. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const build = require('./build');
const ref = process.argv[2];
const fresh = build();
if (!ref) { console.log('rebuilt cleanly · ' + fresh.length + ' bytes'); process.exit(0); }
const h = function (s) { return crypto.createHash('sha1').update(s.replace(/\r\n/g, '\n')).digest('hex'); };
const old = fs.readFileSync(ref, 'utf8');
if (h(old) === h(fresh)) { console.log('IDENTICAL to ' + path.basename(ref)); process.exit(0); }
console.error('DRIFT: rebuild differs from ' + path.basename(ref) +
  ' (committed ' + old.length + ' / rebuilt ' + fresh.length + ' bytes)');
process.exit(1);
