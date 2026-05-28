export async function onRequestPost(context) {
  const { request, env } = context;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  if (data.website) {
    return json({ ok: false, error: 'Spam detected' }, 400);
  }

  const errors = validate(data);
  if (errors.length) {
    return json({ ok: false, error: 'Validation failed', fields: errors }, 400);
  }

  const backendUrl = env.READ2LEAD_BACKEND_URL;
  if (!backendUrl) {
    return json({ ok: false, error: 'Backend not configured' }, 500);
  }

  try {
    const upstream = await fetch(`${backendUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        child_name: data.child_name,
        age: parseInt(data.age, 10),
        level: data.level,
      }),
    });

    const result = await upstream.json();
    return json(result, upstream.status);
  } catch (err) {
    console.error('Backend call failed:', err.message);
    return json({ ok: false, error: 'Backend unavailable' }, 502);
  }
}

function validate(data) {
  const errors = [];
  if (!data.child_name || data.child_name.trim().length === 0 || data.child_name.length > 50) errors.push('child_name');
  const age = parseInt(data.age, 10);
  if (isNaN(age) || age < 5 || age > 14) errors.push('age');
  if (!['L1', 'L2', 'L3'].includes(data.level)) errors.push('level');
  return errors;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
