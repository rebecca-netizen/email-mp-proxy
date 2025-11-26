// api/send-mp-email.js
// Send MP emails via SendGrid + log full body, with CORS support

const sgMail = require("@sendgrid/mail");

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "";
const LOG_WEBHOOK_URL = process.env.LOG_WEBHOOK_URL || ""; // optional: Zapier/Notion/etc
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";  // can later lock to your domains

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

module.exports = async function (req, res) {
  // ---- CORS headers ----
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    // Preflight
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  if (!SENDGRID_API_KEY || !FROM_EMAIL) {
    res.statusCode = 500;
    return res.end("Email service not configured");
  }

  try {
    const {
      to,          // MP email
      subject,
      body,
      userEmail,   // constituent email
      userName,    // constituent name (optional)
      mpName,
      constituency,
      postcode,
      page,
    } = req.body || {};

    if (!to || !subject || !body || !userEmail) {
      res.statusCode = 400;
      return res.end("Missing required fields");
    }

    const msg = {
      to,
      from: FROM_EMAIL,   // e.g. mailer@emailyourmp.org.uk
      subject,
      text: body,
      replyTo: userEmail, // replies go straight to constituent
    };

    await sgMail.send(msg);

    // ---- Log final email (including body) to your webhook ----
    if (LOG_WEBHOOK_URL) {
      try {
        await fetch(LOG_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "mp-email-sent",
            to,
            subject,
            body,           // full final text
            userEmail,
            userName,
            mpName,
            constituency,
            postcode,
            page,
            ts: new Date().toISOString(),
            ua: req.headers["user-agent"] || "",
            ip:
              req.headers["x-forwarded-for"] ||
              req.socket?.remoteAddress ||
              "",
          }),
        });
      } catch (err) {
        console.error("Failed to log to webhook", err);
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error("send-mp-email error", err);
    res.statusCode = 500;
    res.end("Error sending email");
  }
};
