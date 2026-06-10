export type QuestNodeState = 'done' | 'current' | 'locked';

export interface QuestNode {
  icon: string;
  label: string;
  state: QuestNodeState;
}

export function renderQuestPath(
  el: HTMLElement,
  nodes: QuestNode[],
  onSelect?: (index: number) => void,
): void {
  el.innerHTML = nodes
    .map(
      (node, index) => `
        <li class="r2l-kid-quest-path__node r2l-kid-quest-path__node--${node.state}" data-r2l-quest-index="${index}">
          <button type="button" class="r2l-kid-quest-path__btn" ${node.state === 'locked' ? 'disabled' : ''} aria-label="${escapeAttr(node.label)}">
            <span class="r2l-kid-quest-path__icon">${node.state === 'done' ? '✅' : node.state === 'locked' ? '🔒' : escapeHtml(node.icon)}</span>
            <span class="r2l-kid-quest-path__label">${escapeHtml(node.label)}</span>
          </button>
        </li>
      `,
    )
    .join('');

  if (onSelect) {
    el.querySelectorAll<HTMLButtonElement>('.r2l-kid-quest-path__btn:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => {
        const li = btn.closest('[data-r2l-quest-index]');
        const index = Number(li?.getAttribute('data-r2l-quest-index'));
        if (!Number.isNaN(index)) onSelect(index);
      });
    });
  }
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
