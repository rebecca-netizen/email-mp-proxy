// api/log.js — log events (e.g., copy_message) without redirect, with per-client auth

const WEBHOOK = process.env.LOG_WEBHOOK_URL || ""; // same webhook you used for /api/track

// Shared with mp.js (you can extract to a helper file later if you like)
const CLIENTS = {
  client1: process.env.CLIENT1_TOKEN || "",
  client2: process.env.CLIENT2_TOKEN || "",
};

function isAuthorised(client_id, client_token) {
  if (!client_id || !client_token) return false;
  const expected = CLIENTS[client_id];
  if (!expected) return false;
  return expected === client_token;
}

module.exports = async function (req, res) {
  try {
    const isPost = (req.method || "GET").toUpperCase() === "POST";
    let data = {};

    if (isPost && req.body) {
      data = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
    } else {
      data = req.query || {};
    }

    const client_id = (data.client_id || "").toString();
    const client_token = (data.client_token || "").toString();

    if (!isAuthorised(client_id, client_token)) {
      res.statusCode = 403;
      return res.end("unauthorised client");
    }

    // Normalise fields
    const payload = {
      ts: new Date().toISOString(),
      event: data.event || "copy_message", // default
      email: data.email || "",             // may be blank for copy events
      subject: data.subject || "",
      bodyLength: (data.body && typeof data.body === "string") ? data.body.length : (data.bodyLength || ""),
      mp: data.mp || "",
      constituency: data.constituency || "",
      postcode: data.postcode || "",
      page: data.page || "",
      ua: req.headers["user-agent"] || "",
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || ""
    };

    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        console.warn("Log webhook failed:", e.message);
      }
    }

    res.statusCode = 204; // no content
    return res.end();
  } catch (e) {
    res.statusCode = 500;
    res.end("Log error");
  }
};
