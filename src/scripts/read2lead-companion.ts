import { mountMonsterBuilder, monsterBuilderHtml } from '../lib/monster-builder';

const message = document.getElementById('companion-message')!;
const retry = document.getElementById('companion-retry') as HTMLButtonElement;
const home = document.getElementById('companion-home') as HTMLAnchorElement;
const host = document.getElementById('companion-host')!;
async function load() {
  retry.hidden = true; message.hidden = false; message.textContent = 'Đang mở bạn đồng hành…';
  try {
    const params = new URLSearchParams(location.search);
    let code = params.get('code') || '';
    if (params.has('t')) {
      const response = await fetch('/api/r2l-link?token=' + encodeURIComponent(params.get('t') || ''));
      const identity = await response.json();
      if (!response.ok || !identity.access_code) throw Error('Link này chưa mở được. Ba mẹ nhắn Coach Felix nhé.');
      code = identity.access_code;
    } else if (!params.has('code')) {
      try { code = sessionStorage.getItem('r2l_access_code') || ''; } catch { /* optional */ }
    }
    if (!code) throw Error('Mở link riêng của con để chọn bạn đồng hành nhé.');
    home.href = '/read2lead?code=' + encodeURIComponent(code);
    const response = await fetch('/api/read2lead-shop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: code, action: 'list' }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw Error(data.message || 'Chưa mở được. Con thử lại nhé.');
    host.innerHTML = monsterBuilderHtml(data.read2lead_state.student_name || 'con');
    mountMonsterBuilder(host.firstElementChild as HTMLElement, code, data.read2lead_state);
    message.hidden = true;
  } catch (error) {
    message.textContent = error instanceof TypeError ? 'Mất kết nối. Con thử lại nhé.' : error instanceof Error ? error.message : 'Chưa mở được bạn đồng hành.';
    retry.hidden = false;
  }
}
retry.addEventListener('click', load);
void load();
