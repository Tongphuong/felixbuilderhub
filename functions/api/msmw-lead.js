export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (data.website) {
    return jsonResponse({ ok: true }, 200);
  }

  const errors = validate(data);
  if (errors.length > 0) {
    return jsonResponse({ ok: false, error: 'Validation failed', errors }, 400);
  }

  const versionLabel = data.version === 'digital' ? 'Bản số (69k)' : 'Bản in (129k)';
  const genderLabel = data.child_gender === 'boy' ? 'Bé trai' : 'Bé gái';
  const note = data.note?.trim() || '(không có)';
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const message = [
    '🎯 NEW MSMW LEAD',
    '',
    `👨‍👩 Phụ huynh: ${data.parent_name}`,
    `📞 Zalo: ${data.zalo_phone}`,
    '',
    `👶 Tên con: ${data.child_name}`,
    `🎂 Tuổi: ${data.child_age}`,
    `⚧ Giới tính: ${genderLabel}`,
    '',
    `📦 Phiên bản: ${versionLabel}`,
    '',
    '💬 Lời nhắn:',
    note,
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
      const errText = await tgRes.text();
      console.error('Telegram API failed:', tgRes.status, errText);
      console.error('Lead data (for manual recovery):', JSON.stringify(data));
      return jsonResponse({ ok: false, error: 'Telegram delivery failed' }, 500);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error('Telegram call exception:', err.message);
    console.error('Lead data (for manual recovery):', JSON.stringify(data));
    return jsonResponse({ ok: false, error: 'Network error' }, 500);
  }
}

function validate(data) {
  const errors = [];
  if (!data.parent_name || data.parent_name.trim().length === 0 || data.parent_name.length > 100) errors.push('parent_name');
  if (!data.child_name || data.child_name.trim().length === 0 || data.child_name.length > 50) errors.push('child_name');
  const age = parseInt(data.child_age, 10);
  if (isNaN(age) || age < 2 || age > 15) errors.push('child_age');
  if (!['boy', 'girl'].includes(data.child_gender)) errors.push('child_gender');
  if (!['digital', 'hardcopy'].includes(data.version)) errors.push('version');
  if (!data.zalo_phone || !/^[+0-9\s\-()]{8,20}$/.test(data.zalo_phone)) errors.push('zalo_phone');
  if (data.note && data.note.length > 500) errors.push('note');
  return errors;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
