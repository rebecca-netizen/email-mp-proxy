// Exact emergency lookup. No network requests and no supporter data logging.
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
let cached;
const hash = b => createHash('sha256').update(b).digest('hex');
function load() {
  if (cached) return cached;
  const dir = path.join(__dirname, 'postcodes');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const namesBytes = fs.readFileSync(path.join(dir, 'names.json'));
  const names = JSON.parse(namesBytes.toString('utf8'));
  const data = gunzipSync(fs.readFileSync(path.join(dir, 'lookup.bin.gz')));
  if (manifest.schemaVersion !== 1 || manifest.recordWidth !== 9 ||
      data.length !== manifest.recordCount * 9 || names.length !== manifest.constituencyCount ||
      hash(data) !== manifest.dataSha256 || hash(namesBytes) !== manifest.namesSha256) {
    throw new Error('Invalid emergency lookup data');
  }
  const rows = require('../api/data/emails.json');
  const byCon = new Map();
  for (const row of rows) {
    if (!row || typeof row.constituency !== 'string') continue;
    const key = row.constituency.toLowerCase();
    if (byCon.has(key)) throw new Error('Ambiguous curated constituency');
    byCon.set(key, row);
  }
  for (const name of names) {
    if (!byCon.has(name.toLowerCase())) throw new Error('Unmatched emergency constituency');
  }
  cached = { data, names, byCon };
  return cached;
}
function lookup(postcode) {
  if (typeof postcode !== 'string' || postcode.length > 32) return null;
  const pc = postcode.toUpperCase().replace(/\s/g, '');
  if (!/^(?:[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}|GIR0AA)$/.test(pc)) return null;
  const { data, names, byCon } = load();
  const key = pc.padEnd(7, ' ');
  let lo = 0, hi = data.length / 9 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const current = data.toString('ascii', mid * 9, mid * 9 + 7);
    if (current < key) lo = mid + 1;
    else if (current > key) hi = mid - 1;
    else {
      const name = names[data.readUInt16LE(mid * 9 + 7)];
      if (!name) throw new Error('Invalid emergency constituency ID');
      const row = byCon.get(name.toLowerCase());
      // Missing/null emails remain unavailable; never guess or return undefined.
      if (!row || !row.mp_name || typeof row.email !== 'string' ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) return null;
      return { name: row.mp_name, party: row.party || null, email: row.email.trim(),
        constituency: row.constituency, person_id: null, contact_url: null };
    }
  }
  return null;
}
module.exports = { lookup };
