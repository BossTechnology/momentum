/* ═══════════════════════════════════════════════════════════════════════════
   api/profile.js — MOMENTUM heavy ingestion path   (Build Spec v1 §1.3, Phase 3)

   Sits beside api/bobby.js. Four actions on one endpoint:

     sign     → signed Supabase Storage upload URL (browser uploads direct;
                a large file never passes through a function)
     profile  → stream the stored object row-by-row, single pass, running
                aggregates, constant memory, and return the profile JSON
     store    → persist a profile JSON keyed by dataset id
     load     → fetch a stored profile by dataset id

   The profiling cores are required verbatim from ./_profile-core.js and
   ./_ingest-core.js — the same files the browser inlines — so the light and
   heavy paths cannot drift into two different profile schemas.

   An 84 MB xlsx unpacks to ~850 MB of XML. It is never loaded whole: the ZIP
   central directory is read from the tail with an HTTP Range request, then each
   needed entry is range-fetched and inflated as a stream.

   Environment:
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
     MOMENTUM_DATA_BUCKET   (default 'momentum-data')

   Vercel: this function streams a large object and can exceed the default
   execution ceiling on the 84 MB workbook (~70 s observed). Run it on Fluid
   Compute, or set maxDuration below to a value your plan allows.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const zlib = require('zlib');
const { Readable } = require('stream');

// the cores, loaded into this module's global scope exactly as the browser does
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const sandbox = { console, TextDecoder, Date, Math, JSON, setTimeout };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['_profile-core.js', '_ingest-core.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
}
const M = sandbox.MOMENTUM;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET       = process.env.MOMENTUM_DATA_BUCKET || 'momentum-data';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'POST only' });

  if (!SUPABASE_URL || !SERVICE_KEY)
    return res.status(500).json({ error: 'Supabase is not configured for this deployment.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  try {
    switch (body.action) {
      case 'sign':    return res.status(200).json(await signUpload(body));
      case 'profile': return res.status(200).json({ profile: await profileObject(body) });
      case 'store':   return res.status(200).json(await storeProfile(body));
      case 'load':    return res.status(200).json({ profile: await loadProfile(body.datasetId) });
      default:        return res.status(400).json({ error: 'unknown action' });
    }
  } catch (err) {
    console.error('[api/profile]', err);
    return res.status(500).json({ error: (err && err.message) || 'profiling failed' });
  }
};

/* ── 0 · input bounds ────────────────────────────────────────────────────── */
// datasetId reaches a Storage path and a primary key, and this endpoint takes
// no authentication, so it is bounded here rather than trusted. Supabase
// already rejects a traversed path, but nothing capped the length: a 400
// character id was accepted and produced a 406 character object path.
// The ids the app generates look like 'ds_m4x7q2_a1b', and the bundled mining
// profile uses 'mineria-2026'; both fit well inside this.
function assertDatasetId(id) {
  const s = String(id || '');
  if (!s) throw new Error('datasetId required');
  if (s.length > 128 || !/^[\w.\-]+$/.test(s))
    throw new Error('datasetId must be 1-128 characters of A-Z a-z 0-9 _ . -');
  return s;
}

/* ── 1 · signed upload ───────────────────────────────────────────────────── */
async function signUpload({ datasetId, filename }) {
  datasetId = assertDatasetId(datasetId);
  const safe = String(filename || 'data').replace(/[^\w.\-]+/g, '_').slice(-120);
  const storagePath = `${datasetId}/${safe}`;
  const r = await fetch(
    `${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${storagePath}`,
    { method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      // The upload-sign endpoint does not take expiresIn — a signed upload URL
      // is fixed at 2 hours. upsert is the option it does accept, and it
      // matches the x-upsert header returned for the PUT below.
      body: JSON.stringify({ upsert: true }) });
  if (!r.ok) throw new Error(`could not sign upload (${r.status}: ${await r.text()})`);
  const d = await r.json();
  return {
    storagePath,
    uploadUrl: `${SUPABASE_URL}/storage/v1${d.url}`,
    method: 'PUT',
    headers: { 'x-upsert': 'true' }
  };
}

/* ── 2 · range-reader over a Storage object ──────────────────────────────── */
function objectUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(storagePath)}`;
}
async function objectSize(storagePath) {
  const r = await fetch(objectUrl(storagePath), {
    method: 'HEAD', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`stored object not found (${r.status})`);
  const len = r.headers.get('content-length');
  if (!len) throw new Error('storage did not report a content-length');
  return parseInt(len, 10);
}
async function rangeBytes(storagePath, start, len) {
  const r = await fetch(objectUrl(storagePath), {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               Range: `bytes=${start}-${start + len - 1}` } });
  if (!r.ok && r.status !== 206) throw new Error(`range read failed (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}
async function rangeStream(storagePath, start, len) {
  const r = await fetch(objectUrl(storagePath), {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               Range: `bytes=${start}-${start + len - 1}` } });
  if (!r.ok && r.status !== 206) throw new Error(`range stream failed (${r.status})`);
  return Readable.fromWeb(r.body);
}

/* ── 3 · zip over ranges ─────────────────────────────────────────────────── */
async function openZip(storagePath) {
  const size = await objectSize(storagePath);
  const tailLen = Math.min(size, 66560);
  const tail = await rangeBytes(storagePath, size - tailLen, tailLen);
  const eocd = M.Ingest.zip.findEocd(tail, size - tailLen);
  if (!eocd) throw new Error('file is not a readable .xlsx archive');
  if (eocd.zip64 && eocd.zip64EocdOffset != null) {
    Object.assign(eocd, M.Ingest.zip.parseZip64Eocd(
      await rangeBytes(storagePath, eocd.zip64EocdOffset, 56)));
  }
  const cd = await rangeBytes(storagePath, eocd.cdOffset, eocd.cdSize);
  const entries = M.Ingest.zip.parseCentralDirectory(cd);
  const byName = new Map(entries.map(e => [e.name, e]));
  return { storagePath, size, byName };
}
async function entryChunks(zip, entry, onText) {
  const lh = await rangeBytes(zip.storagePath, entry.localHeaderOffset, 30);
  const off = M.Ingest.zip.dataOffset(lh, entry);
  let stream = await rangeStream(zip.storagePath, off, entry.compressedSize);
  if (entry.method !== 0) stream = stream.pipe(zlib.createInflateRaw());
  stream.setEncoding('utf8');
  for await (const chunk of stream) onText(chunk);
}
async function entryText(zip, name) {
  const e = zip.byName.get(name);
  if (!e) return null;
  let out = '';
  await entryChunks(zip, e, t => { out += t; });
  return out;
}

/* ── 4 · profile ─────────────────────────────────────────────────────────── */
// reference tables are read first so the incident script is known before any
// telemetry row is scored — otherwise the quarantine silently misses.
const REF = /^(l[ií]mites|limits|anomal[ií]as|anomalies|turnos|shifts|roster|mapa|map|routes|diccionario|dictionary|glossary)/i;

async function profileObject({ datasetId, path: storagePath, sourceName, sizeBytes }) {
  if (!storagePath) throw new Error('storage path required');
  // The browser gets this path back from sign, which builds it as
  // `${datasetId}/${filename}`. Requiring that shape keeps a caller from
  // naming any other object in the bucket and having the service key read it.
  datasetId = assertDatasetId(datasetId);
  if (!String(storagePath).startsWith(datasetId + '/'))
    throw new Error('storage path must sit under its datasetId');
  const opts = { datasetId, sourceName, sizeBytes, path: 'heavy',
                 sourceType: (String(sourceName || '').split('.').pop() || '').toLowerCase() };

  const isTabular = /\.(csv|tsv|json)$/i.test(sourceName || '');
  const profile = isTabular ? await profileTabular(storagePath, sourceName, opts)
                            : await profileXlsx(storagePath, opts);
  await storeProfile({ datasetId, profile });
  return profile;
}

async function profileXlsx(storagePath, opts) {
  const zip = await openZip(storagePath);
  const wb   = await entryText(zip, 'xl/workbook.xml');
  const rels = await entryText(zip, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = M.Ingest.parseSharedStrings(await entryText(zip, 'xl/sharedStrings.xml'));
  const styleIsDate   = M.Ingest.parseStyles(await entryText(zip, 'xl/styles.xml'));
  const sheets = M.Ingest.parseWorkbook(wb, rels);
  const ordered = [...sheets.filter(s => REF.test(s.name)), ...sheets.filter(s => !REF.test(s.name))];

  const acc = M.Profile.create(opts);
  for (const sh of ordered) {
    const entry = zip.byName.get(sh.path);
    if (!entry) continue;
    const scanner = M.Ingest.createSheetScanner({
      sharedStrings, styleIsDate, onRow: cells => acc.feed(sh.name, cells) });
    await entryChunks(zip, entry, t => scanner.push(t));
    scanner.end();
    acc.endSheet(sh.name);
    const s = acc.sheets.get(sh.name);
    if (s && s.refResult && s.refResult.kind === 'incidents') acc.applyIncidents(s.refResult.rows);
  }
  return acc.finalize();
}

async function profileTabular(storagePath, sourceName, opts) {
  const size = await objectSize(storagePath);
  const name = String(sourceName || 'data').replace(/\.[^.]+$/, '');
  const acc = M.Profile.create(opts);
  if (/\.json$/i.test(sourceName || '')) {
    const stream = await rangeStream(storagePath, 0, size);
    stream.setEncoding('utf8');
    let text = '';
    for await (const c of stream) text += c;
    const parsed = M.Ingest.rowsFromJson(text);
    acc.feed(name, parsed.header);
    parsed.rows.forEach(r => acc.feed(name, r));
  } else {
    const scanner = M.Ingest.createCsvScanner({ onRow: cells => acc.feed(name, cells) });
    const stream = await rangeStream(storagePath, 0, size);
    stream.setEncoding('utf8');
    for await (const c of stream) scanner.push(c);
    scanner.end();
  }
  acc.endSheet(name);
  return acc.finalize();
}

/* ── 5 · profile persistence, keyed by dataset id ────────────────────────── */
async function storeProfile({ datasetId, profile }) {
  datasetId = assertDatasetId(datasetId);
  if (!profile) throw new Error('profile required');
  const row = {
    dataset_id: datasetId,
    schema_version: profile.schemaVersion,
    source_name: profile.meta && profile.meta.sourceName,
    size_bytes: profile.meta && profile.meta.sizeBytes,
    ingest_path: profile.meta && profile.meta.path,
    rows_profiled: (profile.coverage && profile.coverage.rowsProfiled) || 0,
    profile: profile
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/data_profiles?on_conflict=dataset_id`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               'Content-Type': 'application/json',
               Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`could not store profile (${r.status}: ${await r.text()})`);
  return { stored: true, datasetId };
}

async function loadProfile(datasetId) {
  if (!datasetId) return null;
  datasetId = assertDatasetId(datasetId);
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/data_profiles?dataset_id=eq.${encodeURIComponent(datasetId)}&select=profile`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] ? rows[0].profile : null;
}

// Vercel: raise if your plan allows; the 84 MB reference workbook needs ~70 s.
module.exports.config = { maxDuration: 300 };
