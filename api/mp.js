export default async function handler(req, res) {
  try {
    const { postcode } = req.query;
    if (!postcode) return res.status(400).json({ error: "postcode is required" });

    const KEY = process.env.TWFY_API_KEY; // set on Vercel in a moment
    if (!KEY) return res.status(500).json({ error: "API key not configured" });

    const url = `https://www.theyworkforyou.com/api/getMP?postcode=${encodeURIComponent(postcode)}&output=js&key=${encodeURIComponent(KEY)}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ error: `TWFY ${r.status}` });
    const data = await r.json();

    // Let Squarespace call this endpoint from the browser:
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    return res.status(200).json({
      name: data.name || null,
      party: data.party || null,
      email: data.email || null,
      constituency: data.constituency || null,
      person_id: data.person_id || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || "server error" });
  }
}

function send(res, status, body) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.status(status).json(body);
}

