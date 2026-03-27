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
    const { subject } = req.query;

    const response = await fetch(SHEET_CSV_URL);
    const text = await response.text();

    const rows = text.split("\n").slice(1);

    const mpCounts = {};

    rows.forEach(row => {
      if (!row) return;

      const lower = row.toLowerCase();

      if (subject && !lower.includes(subject.toLowerCase())) return;
      if (!row.includes("@")) return;

      // crude extraction (works with your structure)
      const parts = row.split(",");

      const mpName = parts[6] || "Unknown";
      const constituency = parts[7] || "";
      const party = parts[8] || "";

      const key = mpName + "|" + constituency + "|" + party;

      if (!mpCounts[key]) mpCounts[key] = 0;
      mpCounts[key]++;
    });

    const sorted = Object.entries(mpCounts)
      .map(([key, count]) => {
        const [name, constituency, party] = key.split("|");
        return { name, constituency, party, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: sorted }));

  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Failed" }));
  }
};
