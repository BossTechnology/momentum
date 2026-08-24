/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.OfficeDoc — reading .xlsx and .docx Config Docs

   Both are ZIP archives of XML. The browser can inflate them natively through
   DecompressionStream('deflate-raw'), so this needs no library — which matters
   for a single self-contained HTML file that cannot reach a CDN.

   Both formats reduce to the SAME rows the CSV importer already understands.
   That is the whole design: one canonical contract, thin adapters. A .docx
   table and a .xlsx sheet and a .csv all produce the same array of objects, so
   there is one resolver rather than four, and no format can quietly behave
   differently from the others.

   A .docx is read as TABLES ONLY, deliberately. Prose does not parse
   deterministically, and a configuration that loads differently depending on
   how somebody phrased a sentence is worse than one that refuses to load.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

/* ── a minimal ZIP reader ────────────────────────────────────────────────── */

function u16(b, o){ return b[o] | (b[o + 1] << 8); }
function u32(b, o){ return (b[o] | (b[o+1] << 8) | (b[o+2] << 16) | (b[o+3] << 24)) >>> 0; }

/** Entries from the central directory, which is authoritative — local headers
 *  may carry zeroed sizes when a streaming writer produced the archive. */
function entries(bytes){
  var eocd = -1;
  for(var i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--){
    if(u32(bytes, i) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) return null;
  var count = u16(bytes, eocd + 10);
  var off = u32(bytes, eocd + 16);
  var out = [];
  for(var n = 0; n < count && off < bytes.length; n++){
    if(u32(bytes, off) !== 0x02014b50) break;
    var nameLen  = u16(bytes, off + 28),
        extraLen = u16(bytes, off + 30),
        cmtLen   = u16(bytes, off + 32),
        local    = u32(bytes, off + 42);
    var name = utf8(bytes.subarray(off + 46, off + 46 + nameLen));
    out.push({ name: name, local: local,
               method: u16(bytes, off + 10),
               csize: u32(bytes, off + 20) });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

function readEntry(bytes, e){
  if(u32(bytes, e.local) !== 0x04034b50) return null;
  var nameLen = u16(bytes, e.local + 26), extraLen = u16(bytes, e.local + 28);
  var start = e.local + 30 + nameLen + extraLen;
  var data = bytes.subarray(start, start + e.csize);
  if(e.method === 0) return Promise.resolve(utf8(data));
  if(e.method !== 8) return Promise.resolve(null);   /* only stored and deflate */
  return inflate(data).then(utf8);
}

function inflate(data){
  try {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([data]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function(buf){
      return new Uint8Array(buf);
    });
  } catch(e){ return Promise.resolve(null); }
}

function utf8(b){
  if(!b) return '';
  try { return new TextDecoder('utf-8').decode(b); }
  catch(e){ return String.fromCharCode.apply(null, b); }
}

function find(list, re){
  for(var i = 0; i < list.length; i++) if(re.test(list[i].name)) return list[i];
  return null;
}

/* ── XML, read as text ───────────────────────────────────────────────────── */

function tags(xml, tag){
  var out = [], re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'g'), m;
  while((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function attr(frag, name){
  var m = new RegExp(name + '="([^"]*)"').exec(frag);
  return m ? m[1] : null;
}
function unescapeXml(s){
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function(_, d){ return String.fromCharCode(+d); })
    .replace(/&amp;/g, '&');
}

/* ── .xlsx ───────────────────────────────────────────────────────────────── */

function readXlsx(bytes){
  var list = entries(bytes);
  if(!list) return Promise.resolve({ ok:false, reason:'that .xlsx could not be opened' });
  var sheet = find(list, /^xl\/worksheets\/sheet1\.xml$/) || find(list, /^xl\/worksheets\/.*\.xml$/);
  var sst   = find(list, /^xl\/sharedStrings\.xml$/);
  if(!sheet) return Promise.resolve({ ok:false, reason:'that .xlsx has no worksheet' });

  return Promise.all([readEntry(bytes, sheet), sst ? readEntry(bytes, sst) : null])
    .then(function(res){
      var xml = res[0], shared = [];
      if(res[1]) tags(res[1], 'si').forEach(function(si){
        shared.push(tags(si, 't').map(unescapeXml).join(''));
      });
      if(!xml) return { ok:false, reason:'the worksheet could not be read' };

      var rows = [];
      tags(xml, 'row').forEach(function(rowXml, ri){
        var cells = [], re = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g, m;
        while((m = re.exec(rowXml))){
          var head = m[1] || m[3] || '', body = m[2] || '';
          var ref = attr(head, 'r') || '';
          var col = colIndex(ref);
          var t = attr(head, 't');
          var v = tags(body, 'v')[0];
          var text;
          if(t === 's') text = shared[parseInt(v, 10)] || '';
          else if(t === 'inlineStr') text = tags(body, 't').map(unescapeXml).join('');
          else text = unescapeXml(v == null ? '' : v);
          if(col >= 0) cells[col] = text; else cells.push(text);
        }
        for(var i = 0; i < cells.length; i++) if(cells[i] == null) cells[i] = '';
        rows.push(cells);
      });
      return { ok:true, rows: rows };
    });
}
/** "B7" → 1. Sparse sheets omit empty cells entirely, so a column that skipped
 *  a value would shift every field after it if position were assumed. */
function colIndex(ref){
  var m = /^([A-Z]+)/.exec(String(ref || ''));
  if(!m) return -1;
  var n = 0, s = m[1];
  for(var i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

/* ── .docx — tables only ─────────────────────────────────────────────────── */

function readDocx(bytes){
  var list = entries(bytes);
  if(!list) return Promise.resolve({ ok:false, reason:'that .docx could not be opened' });
  var doc = find(list, /^word\/document\.xml$/);
  if(!doc) return Promise.resolve({ ok:false, reason:'that .docx has no document body' });

  return readEntry(bytes, doc).then(function(xml){
    if(!xml) return { ok:false, reason:'the document body could not be read' };
    var tbls = tags(xml, 'w:tbl');
    if(!tbls.length)
      return { ok:false, reason:'no table found in that .docx',
               hint:'A Config Doc in Word must be a TABLE. Prose cannot be parsed ' +
                    'reliably, and a configuration that loads differently depending on ' +
                    'phrasing is worse than one that refuses to load.' };
    var rows = [];
    tags(tbls[0], 'w:tr').forEach(function(tr){
      var cells = tags(tr, 'w:tc').map(function(tc){
        return tags(tc, 'w:t').map(unescapeXml).join('').trim();
      });
      rows.push(cells);
    });
    return { ok:true, rows: rows };
  });
}

/* ── the entry point ─────────────────────────────────────────────────────── */

/** Rows → the objects fromRows already understands. */
function toObjects(rows){
  if(!rows || !rows.length) return [];
  var head = rows[0].map(function(h){ return String(h || '').trim().toLowerCase(); });
  return rows.slice(1).map(function(r){
    var o = {};
    head.forEach(function(h, i){ if(h) o[h] = r[i] == null ? '' : String(r[i]).trim(); });
    return o;
  }).filter(function(o){
    return Object.keys(o).some(function(k){ return o[k]; });
  });
}

/** Rows out of a binary, WITHOUT deciding what they mean. parseBinary below
 *  hands its rows straight to the Config Doc parser, which was the only reader
 *  there was; a .docx Journey Doc going down that path is read as a
 *  configuration and rejected for declaring no results. Splitting the read
 *  from the interpretation lets one archive reader serve all three documents,
 *  which is the same one-mechanism argument the formats already make. */
function readRows(arrayBuffer, filename){
  var ext = String(filename || '').toLowerCase().split('.').pop();
  var bytes = new Uint8Array(arrayBuffer);
  var reader = ext === 'xlsx' || ext === 'xlsm' ? readXlsx
             : ext === 'docx' ? readDocx : null;
  if(!reader) return Promise.resolve({ ok:false, reason:'unsupported binary format: .' + ext });
  return reader(bytes).then(function(res){
    if(!res.ok) return res;
    var objs = toObjects(res.rows);
    if(!objs.length) return { ok:false, reason:'the table had no rows below its header' };
    return { ok:true, rows: objs };
  });
}

function parseBinary(arrayBuffer, filename){
  return readRows(arrayBuffer, filename).then(function(res){
    if(!res.ok) return res;
    var CD = MOMENTUM.ConfigDoc;
    if(!CD) return { ok:false, reason:'the config parser is unavailable' };
    return CD.fromRows(res.rows);
  });
}

MOMENTUM.OfficeDoc = {
  version: 1, parseBinary: parseBinary, readRows: readRows,
  readXlsx: readXlsx, readDocx: readDocx,
  toObjects: toObjects, entries: entries
};

})();
