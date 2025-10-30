// api/track.js — CommonJS tracking redirect with optional webhook logging

const WEBHOOK = process.env.LOG_WEBHOOK_URL || ""; // optional: set in Vercel → Settings → Environment Variables

module.exports = async function (req, res) {
  try {
    const q = req.query || {};
    const email = (q.email || "").trim();
    const subject = q.subject || "";
    const body = q.body || "";
    const mp = q.mp || "";
    const constituency = q.constituency || "";
    const postcode = q.postcode || "";
    const page = q.page || "";
    const ua = req.headers["user-agent"] || "";
    const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "";

    if (!email) {
      res.statusCode = 400;
      return res.end("Missing email");
    }

    const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ts: new Date().toISOString(),
            email,
            subject,
            bodyLength: body.length,
            mp,
            constituency,
            postcode,
            page,
            ua,
            ip
          })
        });
      } catch (e) {
        console.warn("Track webhook failed:", e.message);
      }
    }

    res.statusCode = 302;
    res.setHeader("Location", mailto);
    return res.end();
  } catch (e) {
    res.statusCode = 500;
    res.end("Tracking error");
  }
};
