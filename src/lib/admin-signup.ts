// "Đăng ký công khai" admin card — founder on/off switch + daily cap for GET/POST /api/admin/signup-config.
// Plain same-origin fetches: the browser's existing admin Basic Auth session covers them, like every other
// /api/admin/* call. The DOM, fetch and confirm are passed in so the logic is testable without a browser.
export interface SignupConfig { ok?: boolean; enabled: boolean; daily_cap: number; today_count: number; message?: string }

export function mountSignupSwitch(
  byId: (id: string) => any,
  deps: { fetch: typeof fetch; confirm: (message: string) => boolean },
) {
  // null until the first successful GET: the card never shows MỞ/ĐÓNG or a cap from made-up defaults.
  let state: SignupConfig | null = null;
  let loadFailed = false;
  let busy = false;
  const FALLBACK = 'Chưa kết nối được. Anh thử lại nhé.';
  const VIETNAMESE = /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
  const say = (text: string) => { byId('signup-cfg-message').textContent = text; };

  const render = () => {
    byId('signup-cfg-retry').hidden = !(loadFailed && !state);
    if (!state) {
      byId('signup-cfg-status').textContent = loadFailed ? 'Không đọc được trạng thái đăng ký.' : 'Đang tải…';
      byId('signup-cfg-status').setAttribute('data-state', 'unknown');
      byId('signup-cfg-toggle').textContent = 'Bật đăng ký';
      byId('signup-cfg-count').textContent = '';
      byId('signup-cfg-cap').value = '';
      return;
    }
    byId('signup-cfg-status').textContent = state.enabled ? 'Đang MỞ' : 'Đang ĐÓNG';
    byId('signup-cfg-status').setAttribute('data-state', state.enabled ? 'on' : 'off');
    byId('signup-cfg-toggle').textContent = state.enabled ? 'Tắt đăng ký' : 'Bật đăng ký';
    byId('signup-cfg-count').textContent = `Hôm nay: ${state.today_count} / ${state.daily_cap} mã mới`;
    byId('signup-cfg-cap').value = String(state.daily_cap);
  };
  // Controls stay disabled while a request is in flight AND until a real state has been read.
  const lock = (value: boolean) => {
    busy = value;
    const off = value || !state;
    byId('signup-cfg-toggle').disabled = off;
    byId('signup-cfg-save').disabled = off;
    byId('signup-cfg-cap').disabled = off;
  };
  async function call(init?: { method: 'POST'; body: unknown }): Promise<boolean> {
    lock(true);
    try {
      const response = await deps.fetch('/api/admin/signup-config', init ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body),
      } : undefined);
      let data: any = {};
      try { data = await response.json(); } catch { data = {}; }
      if (!response.ok || data.ok === false || typeof data.enabled !== 'boolean' || !Number.isFinite(Number(data.daily_cap))) {
        fail(typeof data.message === 'string' && VIETNAMESE.test(data.message) ? data.message : FALLBACK);
        return false;
      }
      state = {
        enabled: data.enabled,
        daily_cap: Number(data.daily_cap),
        today_count: Number.isFinite(Number(data.today_count)) ? Number(data.today_count) : 0,
      };
      loadFailed = false;
      render(); say('');
      return true;
    } catch { fail(FALLBACK); return false; } finally { lock(false); }
  }
  // A failure keeps whatever REAL state we last read; if there is none yet, the card says so and offers a retry.
  function fail(message: string) {
    say(message);
    if (!state) { loadFailed = true; render(); }
  }

  byId('signup-cfg-toggle').addEventListener('click', async () => {
    if (busy || !state) return;
    const turningOn = !state.enabled;
    if (turningOn && !deps.confirm('Mở đăng ký công khai cho mọi người?')) return;
    if (await call({ method: 'POST', body: { enabled: turningOn } }) && turningOn) say('Đã mở đăng ký công khai.');
  });
  byId('signup-cfg-form').addEventListener('submit', async (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (busy || !state) return;
    const raw = String(byId('signup-cfg-cap').value).trim();
    const cap = Number(raw);
    if (!raw || !Number.isInteger(cap) || cap < 0 || cap > 500) { say('Số mã mỗi ngày phải là số nguyên từ 0 đến 500.'); return; }
    if (await call({ method: 'POST', body: { daily_cap: cap } })) say('Đã lưu.');
  });
  byId('signup-cfg-retry').addEventListener('click', () => { if (!busy) { say(''); void call(); } });
  render(); lock(false);
  return { load: () => call() };
}
