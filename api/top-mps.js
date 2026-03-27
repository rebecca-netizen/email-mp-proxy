const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Proper CSV parser (handles commas inside quotes)
function parseCSV(text) {
  const rows = [];
  let current = '';
  let insideQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      row.push(current);
      current = '';
    } else if (char === '\n' && !insideQuotes) {
      row.push(current);
      rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  return rows;
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

    const rows = parseCSV(text);

    const headers = rows[0];
    const data = rows.slice(1);

    const mpCounts = {};

    data.forEach(row => {
      if (!row || row.length < 8) return;

      const rowString = row.join(" ").toLowerCase();

      if (subject && !rowString.includes(subject.toLowerCase())) return;

      const mpIndex = headers.findIndex(h => h.trim().toLowerCase() === "mp");
      const constituencyIndex = headers.findIndex(h => h.trim().toLowerCase() === "constituency");

      // fallback (if exact match fails)
      const mpIndexSafe = mpIndex !== -1 ? mpIndex : headers.findIndex(h => h.toLowerCase().includes("mp "));
      const constituencyIndexSafe = constituencyIndex !== -1 ? constituencyIndex : headers.findIndex(h => h.toLowerCase().includes("constitu"));

      const mpName = row[mpIndexSafe] || "Unknown";
      const constituency = row[constituencyIndexSafe] || "";
      const party = "";

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
