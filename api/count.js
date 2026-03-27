// api/count.js

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async function (req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  try {
    if (!SHEET_CSV_URL) {
      return res.status(500).json({ error: "Missing SHEET_CSV_URL" });
    }

    const { subject } = req.query;

    const response = await fetch(SHEET_CSV_URL);
    const text = await response.text();

    const rows = text.split("\n").slice(1);

    let count = 0;

    rows.forEach(row => {
      if (!row) return;

      // MUCH SAFER: just check the whole row string
      if (!row.includes("@")) return;

      if (subject) {
        if (row.includes(subject)) {
          count++;
        }
      } else {
        count++;
      }
    });

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ count }));

  } catch (err) {
    console.error("count error", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Failed to fetch count" }));
  }
};
