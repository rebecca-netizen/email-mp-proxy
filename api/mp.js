// api/mp.js  — CommonJS version for Vercel

// ---------- Config: your curated email list (RAW GitHub URL) ----------
const EMAIL_SOURCE_URL = "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/main/api/data/emails.json";
// ^ Make sure this URL opens in your browser and shows JSON (no 404)

// ---------- Lightweight in-memory cache for the email list ----------
let EMAILS_CACHE = null;
let EMAILS_CACHE_AT = 0;

async function loadEmails() {
  const now = Date.now();
  // Refresh every 10 minutes
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
    if (row.mp_name) byName[row.mp_name.toLowerCase()] = row.email ?? null;
  }

  EMAILS_CACHE = { byCon, byName };
  EMAILS_CACHE_AT = now;
  return EMAILS_CACHE;
}

// ---------- Helpers ----------
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function send(res, status, body) {
  setCORS(res);
  res.status(status).json(body);
}

// ---------- Serverless function (CommonJS export) ----------
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

    // 1) Primary lookup: TWFY getMP by postcode
    const mpUrl = `https://www.theyworkforyou.com/api/getMP?postcode=${encodeURIComponent(
      postcode
    )}&output=js&key=${encodeURIComponent(KEY)}`;

    const r = await fetch(mpUrl);
    if (!r.ok) return send(res, r.status, { error: `TWFY ${r.status}` });
    const mp = await r.json();

    let { name, party, email, constituency, person_id } = mp || {};

    // 2) Override email from your curated list (by constituency, then by name)
    try {
      const emails = await loadEmails();
      if (constituency) {
        const byCon = emails.byCon[constituency.toLowerCase()];
        if (byCon && String(byCon).trim()) email = byCon;
      }
      if (!email && name) {
        const byName = emails.byName[name.toLowerCase()];
        if (byName && String(byName).trim()) email = byName;
      }
    } catch (e) {
      console.warn("emails.json load failed:", e.message);
    }

    // 3) Contact page fallback
    const contact_url = person_id
      ? `https://www.theyworkforyou.com/mp/?p=${encodeURIComponent(person_id)}`
      : null;

    // 4) Respond
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
