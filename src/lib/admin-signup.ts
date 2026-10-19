// "Đăng ký công khai" admin card — founder on/off switch + daily cap for GET/POST /api/admin/signup-config.
// Plain same-origin fetches: the browser's existing admin Basic Auth session covers them, like every other
// /api/admin/* call. The DOM, fetch and confirm are passed in so the logic is testable without a browser.
export interface SignupConfig { ok?: boolean; enabled: boolean; daily_cap: number; today_count: number; message?: string }

export function mountSignupSwitch(
  byId: (id: string) => any,
  deps: { fetch: typeof fetch; confirm: (message: string) => boolean },
) {
  let state: SignupConfig = { enabled: false, daily_cap: 50, today_count: 0 };
  let busy = false;
  const FALLBACK = 'Chưa kết nối được. Anh thử lại nhé.';
  const VIETNAMESE = /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
  const say = (text: string) => { byId('signup-cfg-message').textContent = text; };

  const render = () => {
    byId('signup-cfg-status').textContent = state.enabled ? 'Đang MỞ' : 'Đang ĐÓNG';
    byId('signup-cfg-status').setAttribute('data-state', state.enabled ? 'on' : 'off');
    byId('signup-cfg-toggle').textContent = state.enabled ? 'Tắt đăng ký' : 'Bật đăng ký';
    byId('signup-cfg-count').textContent = `Hôm nay: ${state.today_count} / ${state.daily_cap} mã mới`;
    byId('signup-cfg-cap').value = String(state.daily_cap);
  };
  const lock = (value: boolean) => {
    busy = value;
    byId('signup-cfg-toggle').disabled = value;
    byId('signup-cfg-save').disabled = value;
  };
  async function call(init?: { method: 'POST'; body: unknown }): Promise<boolean> {
    lock(true);
    try {
      const response = await deps.fetch('/api/admin/signup-config', init ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body),
      } : undefined);
      let data: any = {};
      try { data = await response.json(); } catch { data = {}; }
      if (!response.ok || data.ok === false) {
        say(typeof data.message === 'string' && VIETNAMESE.test(data.message) ? data.message : FALLBACK);
        return false;
      }
      state = {
        enabled: data.enabled === true,
        daily_cap: Number.isFinite(Number(data.daily_cap)) ? Number(data.daily_cap) : state.daily_cap,
        today_count: Number.isFinite(Number(data.today_count)) ? Number(data.today_count) : 0,
      };
      render(); say('');
      return true;
    } catch { say(FALLBACK); return false; } finally { lock(false); }
  }

  byId('signup-cfg-toggle').addEventListener('click', async () => {
    if (busy) return;
    const turningOn = !state.enabled;
    if (turningOn && !deps.confirm('Mở đăng ký công khai cho mọi người?')) return;
    if (await call({ method: 'POST', body: { enabled: turningOn } }) && turningOn) say('Đã mở đăng ký công khai.');
  });
  byId('signup-cfg-form').addEventListener('submit', async (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (busy) return;
    const raw = String(byId('signup-cfg-cap').value).trim();
    const cap = Number(raw);
    if (!raw || !Number.isInteger(cap) || cap < 0 || cap > 500) { say('Số mã mỗi ngày phải là số nguyên từ 0 đến 500.'); return; }
    if (await call({ method: 'POST', body: { daily_cap: cap } })) say('Đã lưu.');
  });
  render();
  return { load: () => call() };
}
