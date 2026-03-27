// api/count.js

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";

module.exports = async function (req, res) {
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
      const cols = row.split(",");

      const email = cols[2];
      const rowSubject = cols[4];

      if (!email || !email.includes("@")) return;

      if (subject) {
        if (rowSubject && rowSubject.includes(subject)) {
          count++;
        }
      } else {
        count++; // fallback = all emails
      }
    });

    res.status(200).json({ count });

  } catch (err) {
    console.error("count error", err);
    res.status(500).json({ error: "Failed to fetch count" });
  }
};
