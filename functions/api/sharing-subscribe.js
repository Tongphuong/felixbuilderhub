export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (data.website) {
    return json({ ok: true }, 200);
  }

  const contact = (data.contact || '').trim();
  if (!contact || contact.length < 6 || contact.length > 100) {
    return json({ ok: false, error: 'Invalid contact' }, 400);
  }

  const name = (data.name || '').trim().slice(0, 50) || '(không cung cấp)';
  const interest = (data.interest || '').trim().slice(0, 200) || '(không cung cấp)';
  const refSource = (data.ref || '').trim().slice(0, 80) || '(không có)';
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const message = [
    '🌱 NEW SHARING SPACE SUBSCRIBER',
    '',
    `👤 Tên: ${name}`,
    `📞 Liên hệ: ${contact}`,
    '',
    '💬 Quan tâm:',
    interest,
    '',
    `🔗 Nguồn: ${refSource}`,
    '',
    `⏰ ${timestamp} UTC`,
  ].join('\n');

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message,
      }),
    });

    if (!tgRes.ok) {
      console.error('sharing-subscribe telegram_failed', { status: tgRes.status, ref: refSource, ts: timestamp });
      return json({ ok: false, error: 'Delivery failed' }, 500);
    }

    return json({ ok: true }, 200);
  } catch (err) {
    console.error('sharing-subscribe telegram_exception', { message: err.message, ref: refSource, ts: timestamp });
    return json({ ok: false, error: 'Network error' }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
