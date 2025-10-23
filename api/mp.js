// ===== Email Your MP API — Final Version =====

// Cache email list in memory for speed
let EMAILS_CACHE = null;
let EMAILS_CACHE_AT = 0;

// 👇 This is your GitHub "raw" file link for MP email addresses
const EMAIL_SOURCE_URL = "https://raw.githubusercontent.com/rebecca-netizen/email-mp-proxy/refs/heads/main/api/data/emails.json";

// Reload from GitHub every 10 minutes
async function loadEmails() {
  const now = Date.now();
  if (EMAILS_CACHE && (now - EMAILS_CACHE_AT) < 10 * 60 * 1000) return EMAILS_CACHE;

  const r = await fetch(EMAIL_SOURCE_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to load emails.json");
  const list = await r.json();

  // Build quick lookup by constituency (case-insensitive)
  const mapByCon = Object.create(null);
  const mapByName = Object.create(null);

  for (const row of list) {
    if (!row) continue;
    if (row.constituency)
      mapByCon[row.constituency.toLowerCase()] = row.email || null;
    if (row.mp_name)
      mapByName[row.mp_name.toLowerCase()] = row.email || null;
  }

  EMAILS_CACHE = { byCon: mapByCon, byName: mapByName };
  EMAILS_CACHE_AT = now;
  return EMAILS_CACHE;
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      setCORS(res);
      return res.status(200).end();
    }

    const { postcode } = req.query;
    if (!postcode) return send(res, 400, { error: "postcode is required" });

    const KEY = process.env.TWFY_API_KEY;
    if (!KEY) return send(res, 500, { error: "API key not configured" });

    // 1️⃣ Lookup MP by postcode
    const mpUrl = `https://www.theyworkforyou.com/api/getMP?postcode=${encodeURIComponent(postcode)}&output=js&key=${encodeURIComponent(KEY)}`;
    const r = await fetch(mpUrl);
    if (!r.ok) return send(res, r.status, { error: `TWFY ${r.status}` });
    const mp = await r.json();

    let { name, party, email, constituency, person_id } = mp || {};

    // Normalise name
    const fullName = name || null;

    // 2️⃣ Fallback A: If email missing, load from your JSON file
    try {
      const emails = await loadEmails();
      const emailByCon = constituency ? emails.byCon[constituency.toLowerCase()] : null;
      const emailByName = fullName ? emails.byName[fullName.toLowerCase()] : null;
      if (emailByCon) email = emailByCon;
      else if (emailByName) email = emailByName;
    } catch (e) {
      console.warn("Email list load failed:", e.message);
    }

    // 3️⃣ Contact page URL fallback
    const contact_url = person_id
      ? `https://www.theyworkforyou.com/mp/?p=${encodeURIComponent(person_id)}`
      : null;

    // 4️⃣ Return data to Squarespace
    return send(res, 200, {
      name: fullName || null,
      party: party || null,
      email: email || null,
      constituency: c
