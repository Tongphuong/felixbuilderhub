export interface KidConfirmOptions {
  title: string;
  body: string;
  okText?: string;
  cancelText?: string;
}

export interface KidAlertOptions {
  title: string;
  body: string;
}

let root: HTMLElement | null = null;
let resolvePending: ((value: boolean) => void) | null = null;
let focusTrapCleanup: (() => void) | null = null;

function getRoot(): HTMLElement {
  if (!root) {
    root = document.getElementById('r2l-kid-modal-root');
  }
  if (!root) {
    root = document.createElement('div');
    root.id = 'r2l-kid-modal-root';
    root.className = 'r2l-kid-modal-root';
    root.hidden = true;
    root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(root);
  }
  return root;
}

function trapFocus(container: HTMLElement) {
  const focusable = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Tab' || focusable.length === 0) return;
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
    } else if (document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  container.addEventListener('keydown', onKeyDown);
  first?.focus();
  return () => container.removeEventListener('keydown', onKeyDown);
}

function closeModal(result: boolean) {
  const el = getRoot();
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '';
  focusTrapCleanup?.();
  focusTrapCleanup = null;
  const resolve = resolvePending;
  resolvePending = null;
  resolve?.(result);
}

function openModal(markup: string, onBackdrop: () => void) {
  const el = getRoot();
  el.innerHTML = markup;
  el.hidden = false;
  el.removeAttribute('aria-hidden');

  const backdrop = el.querySelector('[data-r2l-kid-modal-backdrop]');
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) onBackdrop();
  });

  const dialog = el.querySelector('[data-r2l-kid-modal-dialog]');
  if (dialog instanceof HTMLElement) {
    focusTrapCleanup = trapFocus(dialog);
  }

  function onEsc(event: KeyboardEvent) {
    if (event.key === 'Escape') onBackdrop();
  }
  document.addEventListener('keydown', onEsc, { once: true });
}

export function initKidModal() {
  getRoot();
}

export function kidConfirm(options: KidConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    resolvePending = resolve;
    const okText = options.okText ?? 'Đồng ý';
    const cancelText = options.cancelText ?? 'Huỷ';

    openModal(
      `
        <div class="r2l-kid-modal-backdrop" data-r2l-kid-modal-backdrop>
          <div class="r2l-kid-modal-dialog" data-r2l-kid-modal-dialog role="alertdialog" aria-modal="true">
            <h2 class="r2l-kid-modal__title">${escapeHtml(options.title)}</h2>
            <p class="r2l-kid-modal__body">${escapeHtml(options.body)}</p>
            <div class="r2l-kid-modal__actions">
              <button type="button" class="r2l-kid-modal__cancel" data-r2l-kid-modal-cancel>${escapeHtml(cancelText)}</button>
              <button type="button" class="r2l-kid-modal__ok" data-r2l-kid-modal-ok>${escapeHtml(okText)}</button>
            </div>
          </div>
        </div>
      `,
      () => closeModal(false),
    );

    getRoot().querySelector('[data-r2l-kid-modal-ok]')?.addEventListener('click', () => closeModal(true));
    getRoot().querySelector('[data-r2l-kid-modal-cancel]')?.addEventListener('click', () => closeModal(false));
  });
}

export function kidAlert(options: KidAlertOptions): Promise<void> {
  return new Promise((resolve) => {
    openModal(
      `
        <div class="r2l-kid-modal-backdrop" data-r2l-kid-modal-backdrop>
          <div class="r2l-kid-modal-dialog" data-r2l-kid-modal-dialog role="alertdialog" aria-modal="true">
            <h2 class="r2l-kid-modal__title">${escapeHtml(options.title)}</h2>
            <p class="r2l-kid-modal__body">${escapeHtml(options.body)}</p>
            <div class="r2l-kid-modal__actions">
              <button type="button" class="r2l-kid-modal__ok" data-r2l-kid-modal-ok>OK</button>
            </div>
          </div>
        </div>
      `,
      () => {
        closeModal(true);
        resolve();
      },
    );

    getRoot().querySelector('[data-r2l-kid-modal-ok]')?.addEventListener('click', () => {
      closeModal(true);
      resolve();
    });
  });
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
