// api/send-mp-email.js
// Send MP emails via SendGrid, with CORS and optional logging

const sgMail = require("@sendgrid/mail");

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "";
const WEBHOOK = process.env.LOG_WEBHOOK_URL || "";

// Configure SendGrid once
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
} else {
  console.warn("SENDGRID_API_KEY is not set; send-mp-email will fail.");
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Requested-With"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

module.exports = async function (req, res) {
  // Always set CORS headers
  setCors(res);

  // Handle preflight
  if (req.method === "OPTIONS") {
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
      // required for sending
      to,
      subject,
      body,
      userEmail,

      // optional metadata for logging
      userName,
      mpName,
      constituency,
      postcode,
      page,
    } = req.body || {};

    // Basic validation
    if (!to || !subject || !body || !userEmail) {
      res.statusCode = 400;
      return res.end("Missing required fields");
    }

    const msg = {
      to,
      from: FROM_EMAIL,   // your verified SendGrid sender
      subject,
      text: body,
      replyTo: userEmail, // MP replies go straight to the constituent
    };

    // Send via SendGrid
    await sgMail.send(msg);

    // Optional: log full email + metadata to your webhook
    if (WEBHOOK) {
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "mp-email-sent",
            to,
            subject,
            body,
            userEmail,
            userName: userName || "",
            mpName: mpName || "",
            constituency: constituency || "",
            postcode: postcode || "",
            page: page || "",
            ua: req.headers["user-agent"] || "",
            ip:
              req.headers["x-forwarded-for"] ||
              req.socket?.remoteAddress ||
              "",
            ts: new Date().toISOString(),
          }),
        });
      } catch (err) {
        console.error("send-mp-email: webhook log failed", err);
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error("send-mp-email error", err);
    res.statusCode = 502;
    res.end("Error sending email");
  }
};
