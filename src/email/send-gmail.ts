import nodemailer from "nodemailer";

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function smtpUser(): string | undefined {
  return process.env.GMAIL_USER?.trim() || process.env.SMTP_USER?.trim();
}

function smtpPass(): string | undefined {
  return process.env.GMAIL_APP_PASSWORD?.trim() || process.env.SMTP_PASS?.trim();
}

export function isGmailSmtpConfigured(): boolean {
  return Boolean(smtpUser() && smtpPass());
}

function assertValidRecipient(to: string): void {
  const t = to.trim();
  if (!t || !SIMPLE_EMAIL.test(t)) {
    throw new Error("Invalid recipient email address");
  }
}

/**
 * Sends plain text via Gmail SMTP (smtp.gmail.com:465).
 * Requires GMAIL_USER and GMAIL_APP_PASSWORD (Google account App Password, not the normal login password).
 */
export async function sendPlainTextViaGmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  assertValidRecipient(opts.to);
  const user = smtpUser();
  const pass = smtpPass();
  if (!user || !pass) {
    throw new Error(
      "Gmail SMTP is not configured (set GMAIL_USER + GMAIL_APP_PASSWORD, or SMTP_USER + SMTP_PASS, in .env and restart the API)"
    );
  }
  const fromAddress = process.env.GMAIL_FROM?.trim() || user;
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: { name: "Nova CG", address: fromAddress },
    to: opts.to.trim(),
    subject: opts.subject.trim() || "Nova CG — draft reply",
    text: opts.text,
  });
}
