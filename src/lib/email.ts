// Email delivery for fired alerts.
// Uses Resend's REST API when RESEND_API_KEY is set; otherwise runs in
// "simulated delivery" mode (logs the would-be email, marks as delivered)
// so the demo flow works end-to-end without a live provider configured.

export type AlertEmailPayload = {
  to: string[];
  theme: string;
  type: string;
  severity: string;
  message: string;
  currentPct: number;
  thresholdPct: number | null;
  evidenceQuotes: string[];
  playbook: string | null;
  consoleUrl: string;
};

export type EmailResult = { ok: boolean; simulated: boolean; error?: string; providerId?: string };

function renderEmailHtml(p: AlertEmailPayload): string {
  const sevColor = p.severity === "high" ? "#c0392b" : p.severity === "medium" ? "#006fcf" : "#63769b";
  return `
  <div style="font-family:Hanken Grotesk,Segoe UI,sans-serif;color:#2c3e60;max-width:560px;margin:0 auto;border:1px solid #dde9f6;border-radius:14px;overflow:hidden">
    <div style="background:#00175a;color:#fff;padding:18px 24px;font-family:Archivo,sans-serif;font-weight:800;font-size:16px;">
      Risk Meter Alert <span style="color:${sevColor === '#63769b' ? '#7ab7ee' : sevColor};font-size:11px;letter-spacing:.12em;text-transform:uppercase;margin-left:10px;">${p.severity} · ${p.type}</span>
    </div>
    <div style="padding:22px 24px;">
      <div style="font-family:Archivo,sans-serif;font-weight:800;font-size:19px;color:#00175a;margin-bottom:6px;">${p.theme}</div>
      <p style="font-size:14px;line-height:1.5;color:#2c3e60;margin:0 0 14px;">${p.message}</p>
      <div style="display:flex;gap:18px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#63769b;margin-bottom:16px;">
        <div><b style="color:#006fcf;font-size:18px;display:block;">${p.currentPct}%</b>current rolling rate</div>
        ${p.thresholdPct != null ? `<div><b style="color:#00175a;font-size:18px;display:block;">${p.thresholdPct}%</b>configured trigger</div>` : ""}
      </div>
      ${p.evidenceQuotes.length ? `
        <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9fb0cd;margin-bottom:6px;">Sample evidence (canonical root causes)</div>
        <ul style="margin:0 0 16px;padding-left:18px;font-size:13px;color:#63769b;line-height:1.6;">
          ${p.evidenceQuotes.map((q) => `<li>${q}</li>`).join("")}
        </ul>` : ""}
      ${p.playbook ? `
        <div style="background:#f3f8fd;border:1px solid #d6e6f7;border-radius:10px;padding:14px 16px;font-size:13px;color:#2c3e60;margin-bottom:16px;">
          <b style="color:#00175a;">Suggested playbook:</b> ${p.playbook}
        </div>` : ""}
      <a href="${p.consoleUrl}" style="display:inline-block;background:#006fcf;color:#fff;text-decoration:none;font-family:Archivo,sans-serif;font-weight:700;font-size:13px;padding:11px 20px;border-radius:8px;">Open Decision Console →</a>
    </div>
    <div style="padding:12px 24px;border-top:1px solid #ebf2fb;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#9fb0cd;">
      Risk Meter · Servicing Capabilities &amp; Innovation · Concept Prototype
    </div>
  </div>`;
}

export async function sendAlertEmail(payload: AlertEmailPayload): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_EMAIL_FROM || "Risk Meter <alerts@resend.dev>";
  const html = renderEmailHtml(payload);
  const subject = `[Risk Meter · ${payload.severity.toUpperCase()}] ${payload.theme} — ${payload.type} alert`;

  if (!apiKey) {
    // Simulated delivery — no provider configured. Still "delivers" so the
    // demo flow completes; logs what would have been sent.
    console.log("[email:simulated]", { to: payload.to, subject });
    return { ok: true, simulated: true };
  }

  if (!payload.to.length) {
    return { ok: false, simulated: false, error: "No recipients configured for this alert." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: payload.to, subject, html }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, simulated: false, error: `Resend ${res.status}: ${text}` };
    }
    const json = await res.json();
    return { ok: true, simulated: false, providerId: json.id };
  } catch (err) {
    return { ok: false, simulated: false, error: (err as Error).message };
  }
}
