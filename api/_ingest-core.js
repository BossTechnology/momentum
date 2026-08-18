/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.Ingest — DOM-free streaming readers   (Build Spec v1 §1.3, Phase 3)

   Turns bytes into rows and hands them to MOMENTUM.Profile. No DOM, no fetch.
   The same scanners run in the Web-Worker light path and in api/profile.js,
   which is what guarantees one profile schema from both paths.

   Chunk-safe by construction: every scanner keeps a remainder buffer and only
   cuts the stream at structural boundaries it has actually seen, so a row that
   straddles two chunks is never split.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(root){
'use strict';

var MOMENTUM = root.MOMENTUM = root.MOMENTUM || {};

/* ── XML helpers ─────────────────────────────────────────────────────────── */
var ENT = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" };
function unesc(s){
  if(s.indexOf('&') < 0) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, function(m, g){
    if(g[0] === '#'){
      var code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return isNaN(code) ? m : String.fromCodePoint(code);
    }
    return ENT[g] != null ? ENT[g] : m;
  });
}
function attr(tag, name){
  var re = new RegExp(name + '\\s*=\\s*"([^"]*)"');
  var m = re.exec(tag);
  return m ? unesc(m[1]) : null;
}
/** "BC12" → 54 (0-based column index) */
function colIndex(ref){
  var n = 0;
  for(var i = 0; i < ref.length; i++){
    var c = ref.charCodeAt(i);
    if(c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/* ── workbook.xml → sheet list ───────────────────────────────────────────── */
function parseWorkbook(xml, relsXml){
  var rels = {};
  var rre = /<Relationship\b([^>]*)\/?>/g, rm;
  while((rm = rre.exec(relsXml || ''))){
    var id = attr(rm[1], 'Id'), tgt = attr(rm[1], 'Target');
    if(id && tgt) rels[id] = tgt.replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  var out = [], sre = /<sheet\b([^>]*)\/?>/g, sm, i = 0;
  while((sm = sre.exec(xml))){
    var name = attr(sm[1], 'name'), rid = attr(sm[1], 'r:id') || attr(sm[1], 'id');
    var path = rid && rels[rid] ? rels[rid] : ('worksheets/sheet' + (i + 1) + '.xml');
    out.push({ name: name || ('Sheet' + (i + 1)), path: 'xl/' + path.replace(/^xl\//, ''),
               sheetId: attr(sm[1], 'sheetId') });
    i++;
  }
  return out;
}

/* ── sharedStrings.xml → array (only used on the light path) ─────────────── */
function parseSharedStrings(xml){
  var out = [];
  if(!xml) return out;
  var sre = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g, m;
  while((m = sre.exec(xml))){
    var inner = m[1] || '';
    var txt = '', tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g, t;
    while((t = tre.exec(inner))) txt += unesc(t[1]);
    out.push(txt);
  }
  return out;
}

/* ── styles.xml → which cell formats are dates ───────────────────────────── */
var BUILTIN_DATE = { 14:1,15:1,16:1,17:1,18:1,19:1,20:1,21:1,22:1,45:1,46:1,47:1 };
function parseStyles(xml){
  var isDate = [];
  if(!xml) return isDate;
  var custom = {};
  var nre = /<numFmt\b([^>]*)\/?>/g, n;
  while((n = nre.exec(xml))){
    var id = parseInt(attr(n[1], 'numFmtId'), 10);
    var code = attr(n[1], 'formatCode') || '';
    if(!isNaN(id)) custom[id] = /[dmyhs]/i.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''));
  }
  var block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if(!block) return isDate;
  var xre = /<xf\b([^>]*?)(\/>|>)/g, x;
  while((x = xre.exec(block[1]))){
    var fid = parseInt(attr(x[1], 'numFmtId'), 10);
    isDate.push(!isNaN(fid) && (BUILTIN_DATE[fid] === 1 || custom[fid] === true));
  }
  return isDate;
}
/** Excel serial (1900 system) → ISO string */
function serialToIso(v){
  var ms = Math.round((v - 25569) * 86400000);
  if(v < 60) ms += 86400000;                       // 1900 leap-year bug
  var d = new Date(ms);
  if(isNaN(d.getTime())) return null;
  var iso = d.toISOString();
  return v % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

/* ── sheet XML → rows (chunk-safe scanner) ───────────────────────────────── */
/**
 * createSheetScanner({sharedStrings, styleIsDate, onRow, maxRows})
 *   .push(text)   feed a decoded XML chunk
 *   .end()        flush
 * onRow(cellsArray, rowNumber) — cellsArray is dense, indexed by column.
 */
function createSheetScanner(opt){
  var ss = opt.sharedStrings || [];
  var sd = opt.styleIsDate || [];
  var onRow = opt.onRow;
  var maxRows = opt.maxRows || Infinity;
  var buf = '', rows = 0, done = false, started = false;

  var CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

  function emit(rowXml){
    if(rows >= maxRows){ done = true; return; }
    var head = /^<row\b([^>]*)>/.exec(rowXml);
    var rnum = head ? parseInt(attr(head[1], 'r'), 10) : rows + 1;
    var cells = [];
    CELL.lastIndex = 0;
    var m;
    while((m = CELL.exec(rowXml))){
      var a = m[1], body = m[2] || '';
      var ref = attr(a, 'r');
      var ci = ref ? colIndex(ref) : cells.length;
      if(ci < 0 || ci > 16383) continue;
      var t = attr(a, 't');
      var val = null;
      if(t === 'inlineStr'){
        var txt = '', tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tm;
        while((tm = tre.exec(body))) txt += unesc(tm[1]);
        val = txt;
      } else {
        var vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
        if(vm){
          var raw = unesc(vm[1]);
          if(t === 's'){ var ix = parseInt(raw, 10); val = ss[ix] != null ? ss[ix] : ''; }
          else if(t === 'b'){ val = raw === '1' ? 'TRUE' : 'FALSE'; }
          else if(t === 'e'){ val = null; }
          else if(t === 'str'){ val = raw; }
          else {
            var s = parseInt(attr(a, 's') || '', 10);
            var num = parseFloat(raw);
            if(!isNaN(num) && !isNaN(s) && sd[s]) val = serialToIso(num);
            else val = isNaN(num) ? raw : num;
          }
        } else {
          var im = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body);
          if(im){
            var t2 = '', tre2 = /<t\b[^>]*>([\s\S]*?)<\/t>/g, tm2;
            while((tm2 = tre2.exec(im[1]))) t2 += unesc(tm2[1]);
            val = t2;
          }
        }
      }
      while(cells.length < ci) cells.push(null);
      cells[ci] = val;
    }
    rows++;
    onRow(cells, rnum);
  }

  function drain(){
    if(!started){
      var sdi = buf.indexOf('<sheetData');
      if(sdi < 0){ if(buf.length > 1 << 20) buf = buf.slice(-4096); return; }
      buf = buf.slice(sdi); started = true;
    }
    var i;
    while(!done && (i = buf.indexOf('</row>')) >= 0){
      var start = buf.indexOf('<row');
      if(start < 0 || start > i){ buf = buf.slice(i + 6); continue; }
      emit(buf.slice(start, i + 6));
      buf = buf.slice(i + 6);
    }
    // self-closing empty rows are dropped by the loop above; that is correct —
    // an empty row carries no cells and the profiler skips blank rows anyway.
    if(buf.length > 4 << 20) buf = buf.slice(-(1 << 20));   // runaway guard
  }

  return {
    push: function(text){ if(done) return; buf += text; drain(); },
    end:  function(){ if(!done) drain(); return { rows: rows, truncated: done }; },
    get rows(){ return rows; }
  };
}

/* ── CSV / TSV ───────────────────────────────────────────────────────────── */
function sniffDelimiter(sample){
  var cands = [',', ';', '\t', '|'], best = ',', bestN = 0;
  cands.forEach(function(d){
    var n = (sample.split('\n')[0] || '').split(d).length;
    if(n > bestN){ bestN = n; best = d; }
  });
  return best;
}
/** Chunk-safe RFC-4180 CSV scanner (handles quotes, embedded newlines, CRLF). */
function createCsvScanner(opt){
  var onRow = opt.onRow, delim = opt.delimiter || null;
  var buf = '', field = '', row = [], inQ = false, rows = 0, sniffed = !!delim;
  function flushField(){ row.push(field === '' ? null : field); field = ''; }
  function flushRow(){ flushField(); if(row.length > 1 || row[0] !== null){ rows++; onRow(row, rows); } row = []; }
  function drain(final){
    if(!sniffed){
      if(buf.length < 4096 && !final) return;
      delim = sniffDelimiter(buf.slice(0, 4096)); sniffed = true;
    }
    for(var i = 0; i < buf.length; i++){
      var ch = buf[i];
      if(inQ){
        if(ch === '"'){
          if(buf[i+1] === '"'){ field += '"'; i++; }
          else if(i === buf.length - 1 && !final){ buf = buf.slice(i); return; }
          else inQ = false;
        } else field += ch;
      } else {
        if(ch === '"' && field === '') inQ = true;
        else if(ch === delim) flushField();
        else if(ch === '\n'){ flushRow(); }
        else if(ch === '\r'){ /* skip */ }
        else field += ch;
      }
    }
    buf = '';
  }
  return {
    push: function(t){ buf += t; drain(false); },
    end:  function(){ drain(true); if(field !== '' || row.length) flushRow(); return { rows: rows }; }
  };
}

/* ── JSON (array of objects, or {rows:[…]}) ──────────────────────────────── */
function rowsFromJson(text){
  var data = JSON.parse(text);
  var arr = Array.isArray(data) ? data
          : (data && Array.isArray(data.rows) ? data.rows
          : (data && Array.isArray(data.data) ? data.data : null));
  if(!arr) throw new Error('JSON must be an array of records, or {rows:[…]}');
  if(!arr.length) return { header: [], rows: [] };
  if(Array.isArray(arr[0])) return { header: arr[0].map(String), rows: arr.slice(1) };
  var keys = [];
  arr.slice(0, 200).forEach(function(o){
    Object.keys(o || {}).forEach(function(k){ if(keys.indexOf(k) < 0) keys.push(k); });
  });
  return { header: keys, rows: arr.map(function(o){
    return keys.map(function(k){
      var v = o ? o[k] : null;
      return (v && typeof v === 'object') ? JSON.stringify(v) : v;
    });
  }) };
}

/* ── ZIP central directory (minimal, no dependencies) ────────────────────── */
function u16(b, o){ return b[o] | (b[o+1] << 8); }
function u32(b, o){ return (b[o] | (b[o+1] << 8) | (b[o+2] << 16)) + b[o+3] * 16777216; }

/** Parse the End Of Central Directory record from the tail of a zip. */
function findEocd(tail, tailOffset){
  for(var i = tail.length - 22; i >= 0; i--){
    if(tail[i] === 0x50 && tail[i+1] === 0x4b && tail[i+2] === 0x05 && tail[i+3] === 0x06){
      var rec = {
        entries: u16(tail, i + 10),
        cdSize:  u32(tail, i + 12),
        cdOffset:u32(tail, i + 16),
        zip64: false
      };
      // ZIP64 locator sits 20 bytes before the EOCD
      var z = i - 20;
      if(z >= 0 && tail[z] === 0x50 && tail[z+1] === 0x4b && tail[z+2] === 0x06 && tail[z+3] === 0x07){
        rec.zip64 = true;
        rec.zip64EocdOffset = u32(tail, z + 8) + u32(tail, z + 12) * 4294967296;
      }
      rec.eocdOffset = tailOffset + i;
      return rec;
    }
  }
  return null;
}
function parseZip64Eocd(buf){
  return {
    entries:  u32(buf, 32) + u32(buf, 36) * 4294967296,
    cdSize:   u32(buf, 40) + u32(buf, 44) * 4294967296,
    cdOffset: u32(buf, 48) + u32(buf, 52) * 4294967296
  };
}
/** Parse the central directory bytes → entry list with byte ranges. */
function parseCentralDirectory(cd){
  var out = [], o = 0, dec = new TextDecoder('utf-8');
  while(o + 46 <= cd.length){
    if(!(cd[o] === 0x50 && cd[o+1] === 0x4b && cd[o+2] === 0x01 && cd[o+3] === 0x02)) break;
    var method = u16(cd, o + 10);
    var csize  = u32(cd, o + 20), usize = u32(cd, o + 24);
    var nlen   = u16(cd, o + 28), elen = u16(cd, o + 30), clen = u16(cd, o + 32);
    var lho    = u32(cd, o + 42);
    var name   = dec.decode(cd.subarray(o + 46, o + 46 + nlen));
    if(csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff){
      var ex = cd.subarray(o + 46 + nlen, o + 46 + nlen + elen), eo = 0;
      while(eo + 4 <= ex.length){
        var hid = u16(ex, eo), hsz = u16(ex, eo + 2), p = eo + 4;
        if(hid === 0x0001){
          if(usize === 0xffffffff){ usize = u32(ex, p) + u32(ex, p+4) * 4294967296; p += 8; }
          if(csize === 0xffffffff){ csize = u32(ex, p) + u32(ex, p+4) * 4294967296; p += 8; }
          if(lho   === 0xffffffff){ lho   = u32(ex, p) + u32(ex, p+4) * 4294967296; }
          break;
        }
        eo += 4 + hsz;
      }
    }
    out.push({ name:name, method:method, compressedSize:csize, size:usize, localHeaderOffset:lho });
    o += 46 + nlen + elen + clen;
  }
  return out;
}
/** Local file header is variable-length; compute where the data actually starts. */
function dataOffset(localHeaderBytes, entry){
  var nlen = u16(localHeaderBytes, 26), elen = u16(localHeaderBytes, 28);
  return entry.localHeaderOffset + 30 + nlen + elen;
}

MOMENTUM.Ingest = {
  version: 1,
  parseWorkbook: parseWorkbook,
  parseSharedStrings: parseSharedStrings,
  parseStyles: parseStyles,
  createSheetScanner: createSheetScanner,
  createCsvScanner: createCsvScanner,
  rowsFromJson: rowsFromJson,
  sniffDelimiter: sniffDelimiter,
  zip: { findEocd: findEocd, parseZip64Eocd: parseZip64Eocd,
         parseCentralDirectory: parseCentralDirectory, dataOffset: dataOffset,
         u16: u16, u32: u32 },
  _internals: { unesc: unesc, attr: attr, colIndex: colIndex, serialToIso: serialToIso }
};

})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
