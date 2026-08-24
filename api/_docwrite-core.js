/* ═══════════════════════════════════════════════════════════════════════════
   MOMENTUM.DocWrite — writing .docx and .xlsx, with no library

   MOMENTUM already READS both formats (MOMENTUM.OfficeDoc). It could not write
   either, so every template it offered came out as .csv — including the Journey
   Doc, which the contract says MUST be a .docx table. Handing someone a .csv
   and telling them to save it as a Word table is asking them to do the build
   step by hand, and the first person who types the header row slightly wrong
   gets a document that refuses to load.

   Both formats are ZIP archives of XML, and the reader accepts STORED entries
   (method 0) as well as deflated ones — so a writer needs no compressor. That
   is the whole trick: CRC32, a local header per part, a central directory, and
   the XML. About two hundred lines instead of a 90 KB dependency this file
   could not reach anyway, being a single offline HTML document.

   WHAT IS WRITTEN IS WHAT IS READ. Every document this emits is round-tripped
   back through MOMENTUM.OfficeDoc in the gate, so the two halves cannot drift:
   a change to the reader that broke the writer's output would fail before it
   shipped, which is the same mirroring argument the build step makes for api/.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
var root = typeof window !== 'undefined' ? window
         : (typeof globalThis !== 'undefined' ? globalThis : self);
root.MOMENTUM = root.MOMENTUM || {};
var MOMENTUM = root.MOMENTUM;

/* ── bytes ───────────────────────────────────────────────────────────────── */

function bytes(str){
  if(typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  var out = [], i, c;                       /* Node < 11 and old engines */
  for(i = 0; i < str.length; i++){
    c = str.charCodeAt(i);
    if(c < 0x80) out.push(c);
    else if(c < 0x800){ out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
    else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return new Uint8Array(out);
}

var CRC_TABLE = (function(){
  var t = new Uint32Array(256), c, n, k;
  for(n = 0; n < 256; n++){
    c = n;
    for(k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf){
  var c = 0xffffffff;
  for(var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── a minimal ZIP writer, stored only ───────────────────────────────────── */

/** `files` is [{ name, text }]. Returns a Uint8Array of the archive.
 *  Stored, not deflated: the reader handles method 0, Word and Excel both
 *  open stored archives, and a document of this size gains nothing measurable
 *  from compression that would be worth carrying an encoder for. */
function zip(files){
  var parts = [], offset = 0, central = [];

  function u16(n){ return [n & 0xff, (n >>> 8) & 0xff]; }
  function u32(n){ return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; }

  /* A zeroed DOS date encodes month 0 and day 0, which some unpackers reject
     outright. 1980-01-01 is the epoch of the format and the conventional
     stand-in for "no timestamp"; it also keeps the archive byte-identical
     between runs, which is what lets the gate hash it. */
  var DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1;

  files.forEach(function(f){
    var nameB = bytes(f.name), dataB = bytes(f.text);
    var crc = crc32(dataB), size = dataB.length;
    /* 0x0800 marks the name as UTF-8. Every name here is ASCII, but saying so
       costs two bytes and removes a class of question. */
    var local = [].concat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(size), u32(size), u16(nameB.length), u16(0));
    parts.push(new Uint8Array(local), nameB, dataB);

    central.push([].concat(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(size), u32(size),
      u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)));
    central[central.length - 1].__name = nameB;
    offset += local.length + nameB.length + size;
  });

  var cdStart = offset, cdLen = 0;
  central.forEach(function(rec){
    parts.push(new Uint8Array(rec), rec.__name);
    cdLen += rec.length + rec.__name.length;
  });
  parts.push(new Uint8Array([].concat(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cdLen), u32(cdStart), u16(0))));

  var total = parts.reduce(function(n, p){ return n + p.length; }, 0);
  var out = new Uint8Array(total), at = 0;
  parts.forEach(function(p){ out.set(p, at); at += p.length; });
  return out;
}

function escXml(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    /* Control characters are not representable in XML 1.0 at all. A tab or a
       stray \u0000 pasted from a terminal would produce an archive Word opens
       to an error dialog rather than a document, so they are dropped here
       rather than reported three steps later. */
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

var DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
var RELS = DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="TARGET"/>' +
  '</Relationships>';

/* ── .docx — one table, which is the only thing the reader accepts ───────── */

var W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function para(text, bold){
  return '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r>' +
    (bold ? '<w:rPr><w:b/></w:rPr>' : '') +
    '<w:t xml:space="preserve">' + escXml(text) + '</w:t></w:r></w:p>';
}

/** rows[0] is the header. Returns .docx bytes containing exactly one table.
 *  `opts.title` and `opts.notes` become paragraphs OUTSIDE the table — the
 *  reader takes the first table and ignores prose, so guidance can be written
 *  for the human without becoming content. */
function docxTable(rows, opts){
  opts = opts || {};
  var body = '';
  if(opts.title) body += para(opts.title, true);

  var cells = (rows[0] || []).length;
  var width = Math.max(600, Math.floor(9360 / Math.max(1, cells)));
  var grid = '<w:tblGrid>' + (rows[0] || []).map(function(){
    return '<w:gridCol w:w="' + width + '"/>'; }).join('') + '</w:tblGrid>';
  var borders = '<w:tblBorders>' +
    ['top','left','bottom','right','insideH','insideV'].map(function(s){
      return '<w:' + s + ' w:val="single" w:sz="4" w:color="BFBFBF"/>'; }).join('') +
    '</w:tblBorders>';

  body += '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + borders + '</w:tblPr>' + grid;
  rows.forEach(function(r, ri){
    body += '<w:tr>';
    for(var c = 0; c < cells; c++){
      body += '<w:tc><w:tcPr><w:tcW w:w="' + width + '" w:type="dxa"/>' +
        (ri === 0 ? '<w:shd w:val="clear" w:fill="EDEDED"/>' : '') +
        '</w:tcPr>' + para(r[c] == null ? '' : r[c], ri === 0) + '</w:tc>';
    }
    body += '</w:tr>';
  });
  body += '</w:tbl>';

  body += para('');
  (opts.notes || []).forEach(function(n){ body += para(n); });

  var doc = DECL + '<w:document ' + W_NS + '><w:body>' + body +
    '<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>' +
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>' +
    '</w:body></w:document>';

  return zip([
    { name:'[Content_Types].xml', text: DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>' },
    { name:'_rels/.rels', text: RELS.replace('TARGET', 'word/document.xml') },
    { name:'word/document.xml', text: doc }
  ]);
}

/* ── .xlsx — one sheet of inline strings ─────────────────────────────────── */

function colRef(n){
  var s = '';
  n = n + 1;
  while(n > 0){ var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - r - 1) / 26; }
  return s;
}

function sheetXml(rows){
  var xml = '';
  (rows || []).forEach(function(r, ri){
    xml += '<row r="' + (ri + 1) + '">';
    (r || []).forEach(function(v, ci){
      var s = v == null ? '' : String(v);
      if(!s) return;                        /* sparse: colIndex puts it back */
      xml += '<c r="' + colRef(ci) + (ri + 1) + '" t="inlineStr"><is><t xml:space="preserve">' +
             escXml(s) + '</t></is></c>';
    });
    xml += '</row>';
  });
  return DECL +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' + xml + '</sheetData></worksheet>';
}

/** `sheets` is [{ name, rows }]. Inline strings throughout — no shared-string
 *  table, because every value here is written once and a second part is a
 *  second thing to keep in step. The reader already handles t="inlineStr".
 *
 *  MULTIPLE SHEETS EXIST FOR ONE REASON: guidance. `#` opens a comment in a
 *  .csv, so a template's own explanation is invisible to the parser there —
 *  but a spreadsheet has no comment convention, and the same guidance written
 *  into sheet 1 comes back as rows whose `kind` is "# Rows may be added…".
 *  That is the phantom-declaration bug the Config Doc template already had,
 *  one document over. MOMENTUM.OfficeDoc reads sheet1 and only sheet1, so
 *  anything after it is legible to a person and invisible to the reader —
 *  the same arrangement as prose outside a .docx table. */
function xlsxBook(sheets){
  sheets = (sheets || []).filter(function(s){ return s && s.rows; });
  if(!sheets.length) sheets = [{ name:'Sheet1', rows:[] }];

  var files = [
    { name:'[Content_Types].xml', text: DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function(s, i){
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
          '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') + '</Types>' },
    { name:'_rels/.rels', text: RELS.replace('TARGET', 'xl/workbook.xml') },
    { name:'xl/workbook.xml', text: DECL +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function(s, i){
        var nm = escXml(s.name || ('Sheet' + (i + 1))).slice(0, 31) || ('Sheet' + (i + 1));
        return '<sheet name="' + nm + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>' },
    { name:'xl/_rels/workbook.xml.rels', text: DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function(s, i){
        return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
          (i + 1) + '.xml"/>';
      }).join('') + '</Relationships>' }
  ];
  sheets.forEach(function(s, i){
    files.push({ name:'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(s.rows) });
  });
  return zip(files);
}

/** One sheet, the common case. */
function xlsxSheet(rows, opts){
  opts = opts || {};
  return xlsxBook([{ name: opts.sheetName || 'Sheet1', rows: rows }]);
}

/* ── handing it to the browser ───────────────────────────────────────────── */

var MIME = {
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function download(data, filename){
  try {
    var ext = String(filename || '').toLowerCase().split('.').pop();
    var blob = new Blob([data], { type: MIME[ext] || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 400);
    return true;
  } catch(e){ return false; }
}

MOMENTUM.DocWrite = {
  version: 1, zip: zip, crc32: crc32, bytes: bytes, escXml: escXml,
  docxTable: docxTable, xlsxSheet: xlsxSheet, xlsxBook: xlsxBook,
  download: download
};

})();
