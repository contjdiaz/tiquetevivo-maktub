export async function mirrorBusinessToSheets(business) {
  return postToSheets({ type: "business", business });
}

export async function mirrorOrderToSheets(order, business) {
  return postToSheets({ type: "order", order, business });
}

export async function postToSheets(payload) {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!url) return { skipped: true };

  const body = {
    token: process.env.GOOGLE_SHEETS_WEBHOOK_TOKEN || "",
    source: "tiquetevivo",
    sentAt: new Date().toISOString(),
    ...payload
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}