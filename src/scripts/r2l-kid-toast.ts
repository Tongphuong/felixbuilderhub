const DISMISS_MS = 2500;

let toastEl: HTMLElement | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMsg: string | null = null;

function getToast(): HTMLElement {
  if (!toastEl) {
    toastEl = document.getElementById('r2l-kid-toast');
  }
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'r2l-kid-toast';
    toastEl.className = 'r2l-kid-toast';
    toastEl.hidden = true;
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  return toastEl;
}

function showToast(msg: string) {
  const el = getToast();
  el.textContent = msg;
  el.hidden = false;

  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    el.hidden = true;
    el.textContent = '';
    dismissTimer = null;
    if (pendingMsg) {
      const next = pendingMsg;
      pendingMsg = null;
      showToast(next);
    }
  }, DISMISS_MS);
}

export function initKidToast() {
  getToast();
}

/** Queue of 1 — drops older pending message. */
export function kidToast(msg: string): void {
  const el = getToast();
  if (!el.hidden && dismissTimer) {
    pendingMsg = msg;
    return;
  }
  showToast(msg);
}
