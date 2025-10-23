// api/mp.js — CommonJS + robust fallbacks + curated email override

// ----- Your curated email list (RAW GitHub URL) -----
const EMAIL_SOURCE_URL = "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/main/api/data/emails.json";
// Make sure the URL above loads JSON in your browser (no 404)

// ----- Lightweight in-memory cache for the email list -----
let EMAILS_CACHE = null;
let EMAILS_CACHE_AT = 0;

async function loadEmails() {
  const now = Date.now();
  // refresh every 10 minutes
  if (EMAILS_CACHE && (now - EMAILS_CACHE_AT) < 10 * 60 * 1000) return EMAILS_CACHE;

  const r = await fetch(EMAIL_SOURCE_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load emails.json (${r.status})`);
  const list = await r.json();

  // Build lookups (case-insensitive)
  const byCon = Object.create(null);
  const byName = Object.create(null);
  for (const row of list) {
    if (!row) continue;
    if (row.constituency) byCon[row.constituency.toLowerCase()] = row.email ?? null;
    if (row.mp_name)     byName[row.mp_name.toLowerCase()]         = row.email ?? null;
  }

  EMAILS_CACHE = { byCon, byName };
  EMAILS_CACHE_AT = now;
  return EMAILS_CACHE;
}

// ----- Helpers -----
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function send(res, status, body) {
  setCORS(res);
  res.status(status).json(body);
}

// Normalize a TWFY person/MP object or single-item array to a consistent shape
function normalizePerson(raw) {
  const p = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
  const name =
    p.name ||
    p.full_name ||
    [p.given_name, p.family_name].filter(Boolean).join(" ") ||
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    null;

  return {
    name: name || null,
    party: p.party || null,
    email: p.email || null,
    constituency: p.constituency || null,
    person_id: p.person_id || p.id || null,
  };
}

// ----- Serverless function (CommonJS export) -----
module.exports = async function (req, res) {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      setCORS(res);
      return res.status(200).end();
    }

    const { postcode } = req.query || {};
    if (!postcode) return send(res, 400, { error: "postcode is required" });

    const KEY = process.env.TWFY_API_KEY;
    if (!KEY) return send(res, 500, { error: "API key not configured" });

    // 1) Primary lookup — getMP by postcode
    const mpUrl = `https://www.theyworkforyou.com/api/getMP?postcode=${encodeURIComponent(postcode)}&output=js&key=${encodeURIComponent(KEY)}`;
    const r = await fetch(mpUrl);
    if (!r.ok) return send(res, r.status, { error: `TWFY ${r.status}` });
    const mp = await r.json();

    let { name, party, email, constituency, person_id } = mp || {};

    // 2) Fallback A — if name/email missing but we have person_id → getPerson
    if ((name == null || email == null) && person_id) {
      const personUrl = `https://www.theyworkforyou.com/api/getPerson?id=${encodeURIComponent(person_id)}&output=js&key=${encodeURIComponent(KEY)}`;
      const pr = await fetch(personUrl);
      if (pr.ok) {
        const personRaw = await pr.json();
        const p = normalizePerson(personRaw);
        if (name == null && p.name) name = p.name;
        if (email == null && p.email) email = p.email;
        if (!party && p.party) party = p.party;
        if (!constituency && p.constituency) constituency = p.constituency;
      }
    }

    // 3) Fallback B — still no name? try getMPs by constituency
    if (name == null && constituency) {
      const mpsUrl = `https://www.theyworkforyou.com/api/getMPs?output=js&key=${encodeURIComponent(KEY)}&constituency=${encodeURIComponent(constituency)}`;
      const mr = await fetch(mpsUrl);
      if (mr.ok) {
        const listRaw = await mr.json(); // often an array
        const p = normalizePerson(listRaw);
        if (!name && p.name) name = p.name;
        if (!party && p.party) party = p.party;
        if (!email && p.email) email = p.email;
        if (!person_id && p.person_id) person_id = p.person_id;
      }
    }

    // 4) Override email from your curated list (highest priority)
    try {
      const emails = await loadEmails();
      if (constituency) {
        const byCon = emails.byCon[constituency.toLowerCase()];
        if (byCon && String(byCon).trim()) email = byCon;
        if (byCon === null) email = null; // explicit null in your list = force no email
      }
      if (!email && name) {
        const byName = emails.byName[name.toLowerCase()];
        if (byName && String(byName).trim()) email = byName;
        if (byName === null) email = null;
      }
    } catch (e) {
      console.warn("emails.json load failed:", e.message);
    }

    // 5) Contact page URL
    const contact_url = person_id
      ? `https://www.theyworkforyou.com/mp/?p=${encodeURIComponent(person_id)}`
      : null;

    // 6) Respond
    return send(res, 200, {
      name: name || null,
      party: party || null,
      email: email || null,
      constituency: constituency || null,
      person_id: person_id || null,
      contact_url,
    });

  } catch (e) {
    return send(res, 500, { error: e.message || "server error" });
  }
};
