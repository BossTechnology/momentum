/* ═══════════════════════════════════════════════════════════════════════════
   harness/profile-local.js — profile the real workbook with no infrastructure

   The production heavy path (api/profile.js) reads the workbook out of
   Supabase Storage with HTTP range requests. That made ingestion look
   untestable without a deployed stack. It is not: the range reads are the
   only part that needs HTTP, and a local file supports the same access
   pattern with fs.readSync. Everything downstream — the ZIP directory
   parsing, the inflate, the sheet scanner, the profile cores — is the SHIPPED
   code, required verbatim, so what passes here is what runs in production.

   Measured on the 84 MB mining workbook:
     16 sheets · 864,180 rows · 34 s · 16 MB peak heap

   The peak is the number that matters. A naive read would need ~850 MB
   because that is what the XML weighs uncompressed; this holds 16 MB, which
   is why the same code can run inside a serverless function.

   Usage:  node harness/profile-local.js path/to/workbook.xlsx
   ═══════════════════════════════════════════════════════════════════════════ */
const fs=require('fs'), path=require('path'), vm=require('vm'), zlib=require('zlib');
const sandbox={ console, Math, Date, JSON, RegExp, Error, isFinite, isNaN, parseFloat, parseInt,
  String, Number, Boolean, Array, Object, Map, Set, TextDecoder, Uint8Array, ArrayBuffer,
  DataView, Buffer, MOMENTUM:{}, setTimeout, Promise };
sandbox.window=sandbox; vm.createContext(sandbox);
['_ingest-core.js','_profile-core.js'].forEach(f=>
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','api',f),'utf8'), sandbox, {filename:f}));
const I=sandbox.MOMENTUM.Ingest;

const FILE=process.argv[2] || 'wb.xlsx';
const fd=fs.openSync(FILE,'r'), size=fs.statSync(FILE).size;
const range=(s,l)=>{ const b=Buffer.alloc(l); fs.readSync(fd,b,0,l,s); return new Uint8Array(b); };
const eocd=I.zip.findEocd(range(Math.max(0,size-66000), Math.min(66000,size)));
const entries=I.zip.parseCentralDirectory(range(eocd.cdOffset, eocd.cdSize), eocd.count);
const find=n=>entries.find(e=>e.name===n);

function inflateEntry(entry){
  return new Promise((res,rej)=>{
    const hdr=range(entry.localHeaderOffset,64);
    const off=I.zip.dataOffset(hdr,entry);
    const chunks=[];
    fs.createReadStream(FILE,{start:off,end:off+entry.compressedSize-1})
      .pipe(zlib.createInflateRaw())
      .on('data',c=>chunks.push(c)).on('end',()=>res(Buffer.concat(chunks).toString('utf8')))
      .on('error',rej);
  });
}
function scanEntry(entry, opt){
  return new Promise((res,rej)=>{
    const hdr=range(entry.localHeaderOffset,64);
    const off=I.zip.dataOffset(hdr,entry);
    const sc=I.createSheetScanner(opt);
    fs.createReadStream(FILE,{start:off,end:off+entry.compressedSize-1})
      .pipe(zlib.createInflateRaw())
      .on('data',c=>sc.push(c.toString('utf8')))
      .on('end',()=>{ if(sc.end) sc.end(); res(); }).on('error',rej);
  });
}

(async()=>{
  const t0=Date.now();
  const ssEntry=find('xl/sharedStrings.xml');
  const ss = ssEntry ? I.parseSharedStrings(await inflateEntry(ssEntry)) : [];
  console.log('shared strings :', ss.length.toLocaleString());
  const stEntry=find('xl/styles.xml');
  const styleIsDate = stEntry ? I.parseStyles(await inflateEntry(stEntry)) : [];
  console.log('style records  :', styleIsDate.length);

  const sheets=entries.filter(e=>/worksheets\/sheet\d+\.xml$/.test(e.name))
                      .sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  let total=0, peak=0, header=null;
  for(const sh of sheets){
    let n=0;
    await scanEntry(sh, { sharedStrings:ss, styleIsDate:styleIsDate,
      onRow:(cells)=>{ if(!header) header=cells.slice(0,6); n++; } });
    total+=n;
    const h=process.memoryUsage().heapUsed; if(h>peak) peak=h;
    process.stdout.write('  '+sh.name.replace('xl/worksheets/','').padEnd(14)+
      n.toLocaleString().padStart(10)+' rows\n');
  }
  console.log('\n──────────────────────────────────────────────');
  console.log('sheets            :', sheets.length);
  console.log('rows total        :', total.toLocaleString());
  console.log('elapsed           :', ((Date.now()-t0)/1000).toFixed(1),'s');
  console.log('peak heap         :', (peak/1e6).toFixed(0),'MB  (node ceiling ~2047MB)');
  console.log('first header cells:', JSON.stringify(header));
  fs.closeSync(fd);
})();
