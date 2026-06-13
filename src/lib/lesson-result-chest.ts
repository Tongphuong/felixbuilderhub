import { play as playAudio } from './r2l-audio';

export type PendingChest = {
  rarity: 'common' | 'rare' | 'epic';
  reward: { coins: number; part_id: string | null; part_name?: string };
  duplicate: boolean;
};

export async function openChest(pendingChest: PendingChest): Promise<void> {
  if (!pendingChest || typeof document === 'undefined') return;
  const dialog = findOrCreateDialog(pendingChest);
  if (!dialog) return;

  if (!dialog.open) dialog.showModal();
  setStage(dialog, 'closed');
  await playSafely('chest-shake');
  await wait(1500);

  setStage(dialog, 'cracking');
  await playSafely('chest-crack');
  await wait(800);

  setStage(dialog, 'burst');
  await playSafely('chest-burst');
  await playSafely('coin-clink');
}

function findOrCreateDialog(pendingChest: PendingChest): HTMLDialogElement | null {
  const existing = document.querySelector<HTMLDialogElement>('.w2-chest-modal');
  if (existing) return existing;
  if (!document.body) return null;

  const dialog = document.createElement('dialog');
  dialog.className = 'w2-chest-modal';
  dialog.dataset.rarity = pendingChest.rarity;
  for (const stageName of ['closed', 'cracking', 'burst'] as const) {
    const stage = document.createElement('div');
    stage.className = 'w2-chest-stage';
    stage.dataset.stage = stageName;
    stage.hidden = stageName !== 'closed';
    if (stageName === 'burst') stage.appendChild(buildReward(pendingChest));
    dialog.appendChild(stage);
  }
  document.body.appendChild(dialog);
  return dialog;
}

function buildReward(pendingChest: PendingChest): HTMLElement {
  const reward = document.createElement('div');
  reward.className = 'w2-chest-reward';

  const coins = document.createElement('span');
  coins.className = 'w2-reward-coins';
  coins.textContent = `🪙 +${pendingChest.reward.coins}`;
  reward.appendChild(coins);

  if (pendingChest.reward.part_id && !pendingChest.duplicate) {
    const part = document.createElement('span');
    part.className = 'w2-reward-part';
    part.textContent = `Mới: ${pendingChest.reward.part_name || pendingChest.reward.part_id}`;
    reward.appendChild(part);
  }
  if (pendingChest.duplicate) {
    const duplicate = document.createElement('span');
    duplicate.className = 'w2-reward-dup';
    duplicate.textContent = 'Trùng → +xu bonus 🎉';
    reward.appendChild(duplicate);
  }

  const close = document.createElement('button');
  close.className = 'w2-chest-close';
  close.type = 'button';
  close.textContent = 'Tiếp tục';
  close.addEventListener('click', () => reward.closest<HTMLDialogElement>('dialog')?.close());
  reward.appendChild(close);
  return reward;
}

function setStage(dialog: HTMLElement, stage: 'closed' | 'cracking' | 'burst'): void {
  for (const element of dialog.querySelectorAll<HTMLElement>('.w2-chest-stage')) {
    element.hidden = element.dataset.stage !== stage;
  }
  dialog.dataset.stage = stage;
}

async function playSafely(name: string): Promise<void> {
  try {
    await playAudio(name);
  } catch {
    /* visual sequence continues without audio */
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
