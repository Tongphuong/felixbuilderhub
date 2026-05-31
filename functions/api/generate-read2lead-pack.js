export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  // Honeypot
  if (data.website) {
    return json({ ok: false, error: 'Spam detected' }, 400);
  }

  // Validate child fields
  const errors = validate(data);
  if (errors.length) {
    return json({ ok: false, error: 'Validation failed', fields: errors }, 400);
  }

  // Validate access code
  const accessCode = (data.access_code || '').trim().toUpperCase();
  if (!accessCode) {
    return json({ ok: false, error: 'code_missing', message: 'Vui lòng nhập mã đăng nhập.' }, 400);
  }

  if (!env.READ2LEAD_CODES) {
    console.error('READ2LEAD_CODES KV binding missing');
    return json({ ok: false, error: 'config_error', message: 'Hệ thống chưa cấu hình mã. Vui lòng nhắn Zalo Felix.' }, 500);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    return json({ ok: false, error: 'code_not_found', message: 'Mã không tồn tại. Kiểm tra lại hoặc nhắn Zalo Felix.' }, 403);
  }

  // Expiry check
  if (codeData.expires_at) {
    const today = new Date().toISOString().slice(0, 10);
    if (codeData.expires_at < today) {
      return json({ ok: false, error: 'code_expired', message: 'Mã đã hết hạn. Vui lòng liên hệ Felix qua Zalo để gia hạn.' }, 403);
    }
  }

  // Uses check
  if ((codeData.uses_remaining ?? 0) <= 0) {
    return json({ ok: false, error: 'code_exhausted', message: 'Mã đã hết lượt. Vui lòng liên hệ Felix qua Zalo để gia hạn.' }, 403);
  }

  const backendUrl = env.READ2LEAD_BACKEND_URL;
  if (!backendUrl) {
    return json({ ok: false, error: 'backend_not_configured', message: 'Backend chưa cấu hình.' }, 500);
  }

  // Forward to Render backend (do NOT pass access_code downstream)
  let upstreamResult;
  try {
    const interests = (data.interests || '').toString().trim().slice(0, 120);
    const topic = (data.topic || '').toString().trim().slice(0, 60);
    const upstream = await fetch(`${backendUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        child_name: data.child_name,
        age: parseInt(data.age, 10),
        level: data.level,
        child_gender: data.child_gender,
        interests: interests || undefined,
        topic: topic || undefined,
      }),
    });
    upstreamResult = { status: upstream.status, body: await upstream.json() };
  } catch (err) {
    console.error('Backend call failed:', err.message);
    return json({ ok: false, error: 'backend_unavailable', message: 'Backend không phản hồi. Thử lại sau.' }, 502);
  }

  // Only decrement if backend succeeded
  if (upstreamResult.body && upstreamResult.body.ok) {
    const updatedCode = {
      ...codeData,
      uses_remaining: (codeData.uses_remaining ?? 0) - 1,
      last_used_at: new Date().toISOString().slice(0, 10),
    };
    await env.READ2LEAD_CODES.put(accessCode, JSON.stringify(updatedCode));
  }

  return json(upstreamResult.body, upstreamResult.status);
}

function validate(data) {
  const errors = [];
  if (!data.child_name || data.child_name.trim().length === 0 || data.child_name.length > 50) errors.push('child_name');
  const age = parseInt(data.age, 10);
  if (isNaN(age) || age < 5 || age > 14) errors.push('age');
  if (!['L1', 'L2', 'L3'].includes(data.level)) errors.push('level');
  if (!['boy', 'girl'].includes(data.child_gender)) errors.push('child_gender');
  return errors;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
