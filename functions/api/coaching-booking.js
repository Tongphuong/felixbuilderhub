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

  const errors = [];
  if (!data.parent_name || data.parent_name.length > 100) errors.push('parent_name');
  if (!data.child_name || data.child_name.length > 50) errors.push('child_name');
  const age = parseInt(data.child_age, 10);
  if (isNaN(age) || age < 5 || age > 16) errors.push('child_age');
  if (!['beginner', 'basic', 'intermediate', 'advanced', 'unsure'].includes(data.english_level)) errors.push('english_level');
  if (!data.zalo_phone || !/^[+0-9\s\-()]{8,20}$/.test(data.zalo_phone)) errors.push('zalo_phone');
  if (data.goals && data.goals.length > 300) errors.push('goals');
  if (errors.length) {
    return json({ ok: false, error: 'Validation failed', fields: errors }, 400);
  }

  const levelLabels = {
    beginner: 'Mới bắt đầu',
    basic: 'Cơ bản',
    intermediate: 'Trung bình',
    advanced: 'Khá',
    unsure: 'Không chắc',
  };

  const goals = data.goals?.trim() || '(không cung cấp)';
  const refSource = (data.ref || '').trim().slice(0, 80) || '(không có)';
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const message = [
    '🎓 NEW COACHING CONSULTATION REQUEST',
    '',
    `👨‍👩 Phụ huynh: ${data.parent_name}`,
    `📞 Zalo: ${data.zalo_phone}`,
    '',
    `👶 Tên con: ${data.child_name}`,
    `🎂 Tuổi: ${data.child_age}`,
    `📊 Level: ${levelLabels[data.english_level]}`,
    '',
    '🎯 Mục tiêu:',
    goals,
    '',
    `🔗 Nguồn: ${refSource}`,
    '',
    `⏰ ${timestamp} UTC`,
  ].join('\n');

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }),
    });

    if (!tgRes.ok) {
      console.error('Telegram failed:', tgRes.status);
      console.error('Booking data:', JSON.stringify(data));
      return json({ ok: false, error: 'Delivery failed' }, 500);
    }

    return json({ ok: true }, 200);
  } catch (err) {
    console.error('Telegram exception:', err.message);
    console.error('Booking data:', JSON.stringify(data));
    return json({ ok: false, error: 'Network error' }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
