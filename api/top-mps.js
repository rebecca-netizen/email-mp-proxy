const SHEET_CSV_URL = process.env.SHEET_CSV_URL || "";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// CSV parser (handles commas inside quotes)
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
    const data = rows.slice(1);

    const mpCounts = {};

    data.forEach(row => {
      if (!row) return;

      const fullRow = row.join(" ");

      // Filter by subject (keeps your campaign-specific counts)
      if (subject) {
      const subjectField = row[4] || ""; // Subject column
      if (!subjectField.toLowerCase().includes(subject.toLowerCase())) return;
      }

      // Extract MP name using pattern "Name (MP)"
      const match = fullRow.match(/([A-Za-z\s.'-]+)\s*\(MP\)/);

      if (!match) return;

      const mpName = match[1].trim();

      // Optional: extract constituency if present
      const constituencyMatch = fullRow.match(/([A-Za-z\s.'-]+)\s+MP\s+for\s+([A-Za-z\s.'-]+)/i);
      const constituency = constituencyMatch ? constituencyMatch[2].trim() : "";

      const key = mpName + "|" + constituency;

      if (!mpCounts[key]) mpCounts[key] = 0;
      mpCounts[key]++;
    });

    const sorted = Object.entries(mpCounts)
      .map(([key, count]) => {
        const [name, constituency] = key.split("|");
        return { name, constituency, party: "", count };
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
