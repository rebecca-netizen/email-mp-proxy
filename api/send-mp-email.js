// api/send-mp-email.js
// Send MP email via SendGrid and log the exact message body to a webhook

const sgMail = require("@sendgrid/mail");

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "";
const WEBHOOK = process.env.LOG_WEBHOOK_URL || "";

// Configure SendGrid
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

module.exports = async function (req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end("Method not allowed");
  }

  if (!SENDGRID_API_KEY || !FROM_EMAIL) {
    console.error("Missing SENDGRID_API_KEY or FROM_EMAIL env vars");
    res.statusCode = 500;
    return res.end("Email service not configured");
  }

  try {
    const {
      // mail routing
      to,
      subject,
      body,

      // metadata (for logging only)
      userName,
      userEmail,
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

    // Build the message for SendGrid
    const msg = {
      to,
      from: FROM_EMAIL,   // your verified sender, e.g. mailer@emailyourmp.org.uk
      subject,
      text: body,
      replyTo: userEmail, // MP replies go straight to the constituent
    };

    // Send email
    await sgMail.send(msg);

    // Log to webhook AFTER successful send (so this is the final text)
    if (WEBHOOK) {
      const payload = {
        type: "mp-email-sent",
        to,
        from: FROM_EMAIL,
        subject,
        body,                // <-- full body text here
        userName: userName || "",
        userEmail,
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
      };

      // Fire and forget; don't block the response if logging fails
      try {
        await fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (logErr) {
        console.error("Webhook log failed", logErr);
      }
    }

    // Success response back to frontend
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error("send-mp-email error", err);
    res.statusCode = 500;
    res.end("Error sending email");
  }
};
