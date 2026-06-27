import type { ProgressPayload } from './ho-so';
import { escapeHtml, firstName, qs } from './ho-so';

type Lesson = { parent_note_vi?: string; next_suggestion_vi?: string; story?: { title?: string } };
type PortfolioEntry = { id: string; ts?: string; title?: string; note_vi?: string; parent_seen_at?: string | null; reactions?: { heart?: number; clap?: number; strong?: number }; video_url?: string };
type WeeklyTaskState = { completed_task_ids?: string[] };
type ParentTask = { id: 'current_pack' | 'weekly_goal' | 'maintain_streak' | 'next_suggestion'; label: string };

let cachedLesson: Lesson | null = null;
let cachedPortfolio: PortfolioEntry[] = [];
let cachedTasks = new Set<string>();
let cachedPortfolioFailed = false;
let lastFetchCode = '';

function formatDate(value: unknown, includeTime = false) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', includeTime ? { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' } : { day: '2-digit', month: '2-digit' }).format(date);
}

function formatLevel(value: unknown) {
  const text = String(value || "");
  const match = /^L(\d+)/i.exec(text);
  return match && match[0].length === text.length ? "Cấp " + match[1] : text;
}

function buildTasks(data: ProgressPayload, lesson: Lesson | null): ParentTask[] {
  const progress = (data.progress || {}) as Record<string, unknown>;
  const state = (data.read2lead_state || {}) as Record<string, unknown>;
  const growth = (data.weekly_growth || {}) as Record<string, unknown>;
  const pack = progress.current_pack as Record<string, unknown> | undefined;
  const thisWeek = Number(growth.this_week_packs || 0);
  return [
    { id: 'current_pack', label: pack && !String(pack.status || '').includes('reviewed_pass') ? `Cùng con hoàn thành “${String(pack.story_title || 'bài đang mở')}”` : 'Cùng con đọc lại một truyện con yêu thích' },
    { id: 'weekly_goal', label: thisWeek >= 3 ? `Giữ nhịp ${thisWeek} bài trong tuần này` : `Hoàn thành thêm ${Math.max(1, 3 - thisWeek)} bài ngắn trong tuần` },
    { id: 'maintain_streak', label: Number(state.streak_days || 0) ? `Giữ chuỗi ${Number(state.streak_days)} ngày bằng một bài ngày mai` : 'Bắt đầu chuỗi học đều bằng một bài hôm nay' },
    { id: 'next_suggestion', label: lesson?.next_suggestion_vi || 'Dành 10 phút để con kể lại truyện bằng lời của mình' },
  ];
}

function renderSession(name: string, code: string, lastActivity: unknown) {
  return `<div class="ho-so-session ho-so-p-session"><div class="ho-so-session__identity"><span class="fx-eyebrow">Phụ huynh xem</span><span class="ho-so-session__name" data-clarity-mask="true">${escapeHtml(firstName(name))}</span><span class="ho-so-session__code" data-clarity-mask="true">${escapeHtml(code)}</span></div><span class="ho-so-session__stamp">Cập nhật ${escapeHtml(formatDate(lastActivity, true) || 'gần đây')}</span><div class="ho-so-session__actions"><button class="fx-btn fx-btn--ghost fx-btn--sm" type="button" data-ho-so-switch-role>Xem như học sinh</button><button class="fx-btn fx-btn--secondary fx-btn--sm" type="button" data-ho-so-change-code>Đổi mã</button></div></div>`;
}

function renderStats(data: ProgressPayload) {
  const progress = (data.progress || {}) as Record<string, unknown>;
  const state = (data.read2lead_state || {}) as Record<string, unknown>;
  const growth = (data.weekly_growth || {}) as Record<string, unknown>;
  return `<article class="fx-card ho-so-p-stat"><div class="ho-so-p-stat__label"><span class="ho-so-p-stat__icon">📦</span>Bài đã hoàn thành</div><strong>${Number(progress.completed_packs || 0)}</strong><small>${Number(growth.this_week_packs || 0)} bài trong tuần này</small></article><article class="fx-card ho-so-p-stat"><div class="ho-so-p-stat__label"><span class="ho-so-p-stat__icon">🔥</span>Chuỗi ngày</div><strong>${Number(state.streak_days || 0)} <small>ngày liên tiếp</small></strong><small>${Number(state.streak_freeze_tokens || 0)} lượt giữ chuỗi</small></article><article class="fx-card ho-so-p-stat ho-so-p-stat--coins"><div class="ho-so-p-stat__label"><span class="ho-so-p-stat__icon">🪙</span>Xu thưởng</div><strong>${Number(state.coins || 0)} <small>xu</small></strong><small>Dùng để trang trí quái vật</small></article>`;
}

function renderGrowth(data: ProgressPayload) {
  const growth = (data.weekly_growth || {}) as Record<string, unknown>;
  const weeks = Array.isArray(growth.weeks) ? growth.weeks as Array<Record<string, unknown>> : [];
  const maxXp = Math.max(1, ...weeks.map((week) => Number(week.xp || 0)));
  const bars = weeks.map((week) => {
    const xp = Number(week.xp || 0);
    const height = xp ? Math.max(12, Math.round((xp / maxXp) * 100)) : 0;
    return `<div class="ho-so-growth__week" data-current="${week.is_current === true}"><div class="ho-so-growth__track"><span class="ho-so-growth__bar" style="height:${height}%" title="${xp} XP"></span></div><small>${escapeHtml(week.is_current ? 'T này' : week.label_vi || '')}</small></div>`;
  }).join('');
  return `<article class="fx-card ho-so-p-chart"><div class="ho-so-card-head"><h3>Tăng trưởng 6 tuần</h3><small>XP / tuần</small></div>${weeks.length ? `<div class="ho-so-growth" role="img" aria-label="XP trong sáu tuần">${bars}</div>` : '<p class="ho-so-empty">Chưa đủ dữ liệu tuần.</p>'}<p class="ho-so-chart-note">📈 ${escapeHtml(growth.headline || 'Biểu đồ sẽ rõ hơn sau khi con hoàn thành thêm bài.')}</p></article>`;
}

function renderQuality(data: ProgressPayload) {
  const skills = Array.isArray(data.skill_quality?.skills) ? data.skill_quality!.skills! : [];
  const rows = skills.map((skill) => {
    const score = skill.score_percent;
    return `<div><div class="ho-so-quality__head"><strong>${escapeHtml(skill.emoji)} ${escapeHtml(skill.label_vi)}</strong><strong>${score == null ? '—' : `${score}%`}</strong></div><span class="fx-progress" role="progressbar" aria-label="${escapeHtml(skill.label_vi)}" aria-valuenow="${score ?? 0}" aria-valuemin="0" aria-valuemax="100"><span class="fx-progress__fill" style="width:${score ?? 0}%"></span></span></div>`;
  }).join('');
  const available = skills.filter((skill) => skill.score_percent != null);
  const weakest = [...available].sort((a, b) => Number(a.score_percent) - Number(b.score_percent))[0];
  const note = weakest ? `Felix gợi ý: tuần sau ưu tiên ${String(weakest.label_vi).toLowerCase()} để cân bằng kĩ năng.` : 'Chưa đủ dữ liệu — hoàn thành thêm bài để xem từng kĩ năng.';
  return `<article class="fx-card ho-so-p-chart"><div class="ho-so-card-head"><h3>Chất lượng theo kĩ năng</h3><small>% đúng 30 ngày</small></div><div class="ho-so-quality">${rows || '<p class="ho-so-empty">Chưa đủ dữ liệu kĩ năng.</p>'}</div><p class="ho-so-chart-note">💡 ${escapeHtml(note)}</p></article>`;
}

function renderStories(data: ProgressPayload) {
  const storyProgress = (data.story_progress || {}) as Record<string, unknown>;
  const stories = Array.isArray(storyProgress.stories) ? storyProgress.stories as Array<Record<string, unknown>> : [];
  const body = stories.slice(0, 6).map((story) => `<a class="ho-so-story" href="${escapeHtml(story.lesson_path || '#')}"><span class="ho-so-story__icon" aria-hidden="true">${escapeHtml(story.emoji || '📖')}</span><span class="ho-so-story__copy"><strong>${escapeHtml(story.title || 'Truyện')}</strong><small>${escapeHtml([story.topic, formatLevel(story.level), formatDate(story.completed_at)].filter(Boolean).join(' · '))}</small></span>${story.score_percent != null ? `<span class="ho-so-story__score">${Number(story.score_percent)}%</span>` : ''}</a>`).join('');
  return `<div class="ho-so-card-head"><h3>Truyện đã đọc</h3><small>${Number(storyProgress.total_completed || 0)} bài</small></div>${body || `<div class="ho-so-empty">Chưa có truyện nào — bắt đầu bằng cách tạo bài đầu tiên.<div class="mt-3"><a class="fx-btn fx-btn--primary" href="/read2lead#form">Tạo bài đầu tiên →</a></div></div>`}`;
}

function renderTasks(tasks: ParentTask[], completed: Set<string>) {
  const done = tasks.filter((task) => completed.has(task.id)).length;
  return `<div class="ho-so-card-head"><h3>Việc tuần này</h3><span class="fx-badge fx-badge--gold" data-task-count>${done} / ${tasks.length}</span></div><div class="ho-so-task-list">${tasks.map((task) => { const checked = completed.has(task.id); return `<label class="ho-so-task" data-task-id="${task.id}" data-completed="${checked}"><input type="checkbox" ${checked ? 'checked' : ''}/><span class="ho-so-task__check">${checked ? '✓' : ''}</span><span class="ho-so-task__text">${escapeHtml(task.label)}</span></label>`; }).join('')}</div><p class="ho-so-chart-note hidden" data-task-status aria-live="polite"></p>`;
}

function reactionCount(item: PortfolioEntry, kind: 'heart' | 'clap' | 'strong') { return Math.min(99, Math.max(0, Number(item.reactions?.[kind]) || 0)); }

function renderPortfolio(items: PortfolioEntry[], failed: boolean) {
  const unseen = items.filter((item) => !item.parent_seen_at).length;
  const body = failed ? '<p class="ho-so-empty">Chưa tải được video. Vui lòng thử lại sau.</p>' : !items.length ? '<p class="ho-so-empty">Chưa có video — bố mẹ có thể quay 30 giây con kể lại truyện.</p>' : `<div class="ho-so-p-portfolio">${items.map((item) => `<article id="video-${escapeHtml(item.id)}" class="ho-so-video"><video controls playsinline preload="metadata" src="${escapeHtml(item.video_url || '')}" data-portfolio-id="${escapeHtml(item.id)}"></video><div class="ho-so-video__meta"><strong>${escapeHtml(item.title || 'Video buổi học')}</strong><small>${escapeHtml(formatDate(item.ts))}${item.note_vi ? ` · ${escapeHtml(item.note_vi)}` : ''}</small><div class="ho-so-reactions"><button class="ho-so-reaction" type="button" data-reaction-kind="clap" data-portfolio-id="${escapeHtml(item.id)}">👏 <span data-reaction-count="clap">${reactionCount(item, 'clap')}</span></button><button class="ho-so-reaction" type="button" data-reaction-kind="heart" data-portfolio-id="${escapeHtml(item.id)}">❤️ <span data-reaction-count="heart">${reactionCount(item, 'heart')}</span></button><button class="ho-so-reaction" type="button" data-reaction-kind="strong" data-portfolio-id="${escapeHtml(item.id)}">💪 <span data-reaction-count="strong">${reactionCount(item, 'strong')}</span></button></div></div></article>`).join('')}</div>`;
  return `<div class="ho-so-card-head"><h3>Sổ tay video</h3><small>${items.length} video · ${unseen} mới</small></div>${body}<p class="ho-so-chart-note hidden" data-portfolio-status aria-live="polite"></p>`;
}

function attachPortfolioInteractions(root: Element, code: string) {
  root.querySelectorAll<HTMLVideoElement>('video[data-portfolio-id]').forEach((video) => video.addEventListener('play', () => { const id = video.dataset.portfolioId; if (id) void fetch('/api/parent/portfolio-seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, id }), keepalive: true }); }, { once: true }));
  root.querySelectorAll<HTMLButtonElement>('[data-reaction-kind]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.portfolioId || '';
    const kind = button.dataset.reactionKind as 'heart' | 'clap' | 'strong';
    const count = button.querySelector<HTMLElement>(`[data-reaction-count="${kind}"]`);
    if (!id || !kind || !count || button.disabled) return;
    const previous = Number(count.textContent) || 0;
    count.textContent = String(Math.min(99, previous + 1)); button.disabled = true;
    try { const response = await fetch('/api/parent/portfolio-react', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, id, kind }) }); const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(); count.textContent = String(payload.reactions?.[kind] ?? previous); }
    catch { count.textContent = String(previous); const status = qs<HTMLElement>('[data-portfolio-status]', root); if (status) { status.textContent = 'Chưa gửi được cảm xúc. Vui lòng thử lại.'; status.classList.remove('hidden'); } }
    finally { button.disabled = false; }
  }));
  if (window.location.hash.startsWith('#video-')) requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function attachTaskInteractions(root: Element, code: string, tasks: ParentTask[], completed: Set<string>) {
  root.querySelectorAll<HTMLInputElement>('.ho-so-task input').forEach((input) => input.addEventListener('change', async () => {
    const label = input.closest<HTMLElement>('[data-task-id]');
    const id = label?.dataset.taskId as ParentTask['id'] | undefined;
    if (!label || !id) return;
    const previous = !input.checked;
    const apply = (value: boolean) => { input.checked = value; label.dataset.completed = String(value); label.querySelector('.ho-so-task__check')!.textContent = value ? '✓' : ''; if (value) completed.add(id); else completed.delete(id); const count = qs<HTMLElement>('[data-task-count]', root); if (count) count.textContent = `${completed.size} / ${tasks.length}`; };
    apply(input.checked);
    try { const response = await fetch('/api/parent/weekly-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, task_id: id, completed: input.checked }) }); if (!response.ok) throw new Error(); }
    catch { apply(previous); const status = qs<HTMLElement>('[data-task-status]', root); if (status) { status.textContent = 'Chưa lưu được. Vui lòng thử lại.'; status.classList.remove('hidden'); } }
  }));
}

function renderAll(data: ProgressPayload, code: string, lesson: Lesson | null, portfolio: PortfolioEntry[], taskState: Set<string>, failed: boolean) {
  const progress = (data.progress || {}) as Record<string, unknown>;
  const state = (data.read2lead_state || {}) as Record<string, unknown>;
  const name = String(progress.student_name || state.student_name || 'Bé yêu');
  const growth = (data.weekly_growth || {}) as Record<string, unknown>;
  const session = qs<HTMLElement>('#ho-so-parent-session'); const header = qs<HTMLElement>('#ho-so-parent-header'); const stats = qs<HTMLElement>('#ho-so-parent-stats'); const charts = qs<HTMLElement>('#ho-so-parent-charts'); const stories = qs<HTMLElement>('#ho-so-parent-stories'); const tasksHost = qs<HTMLElement>('#ho-so-parent-tasks'); const portfolioHost = qs<HTMLElement>('#ho-so-parent-portfolio');
  if (!session || !header || !stats || !charts || !stories || !tasksHost || !portfolioHost) return;
  session.innerHTML = renderSession(name, code, state.last_activity_at || progress.last_activity_at);
  header.innerHTML = `<div><p class="fx-eyebrow ho-so-accent-eyebrow">Báo cáo tuần</p><h1>${escapeHtml(firstName(name))} ${Number(growth.this_week_packs || 0) ? 'đang giữ nhịp học đều trong tuần này.' : 'chưa học tuần này — bắt đầu lại bằng một buổi ngắn nhé.'}</h1>${lesson?.parent_note_vi ? `<p class="ho-so-chart-note">${escapeHtml(lesson.parent_note_vi)}</p>` : ''}</div><button class="fx-btn fx-btn--ghost" type="button" data-ho-so-print>Tải báo cáo PDF →</button>`;
  stats.innerHTML = renderStats(data);
  charts.innerHTML = renderGrowth(data) + renderQuality(data);
  stories.innerHTML = renderStories(data);
  const taskRows = buildTasks(data, lesson); tasksHost.innerHTML = renderTasks(taskRows, taskState);
  portfolioHost.innerHTML = renderPortfolio(portfolio, failed);
  attachTaskInteractions(tasksHost, code, taskRows, taskState);
  attachPortfolioInteractions(portfolioHost, code);
}

export async function renderParentView(_container: Element, data: ProgressPayload, accessCode: string) {
  if (lastFetchCode === accessCode) { renderAll(data, accessCode, cachedLesson, cachedPortfolio, new Set(cachedTasks), cachedPortfolioFailed); return; }
  const progress = (data.progress || {}) as Record<string, unknown>;
  const pack = progress.current_pack as Record<string, unknown> | undefined;
  const [lessonResult, portfolioResult, tasksResult] = await Promise.all([
    pack?.pack_id && pack.status !== 'generation_in_progress' ? fetch(`/api/read2lead-lesson?code=${encodeURIComponent(accessCode)}&pack_id=${encodeURIComponent(String(pack.pack_id))}`).then((response) => response.ok ? response.json() : null).then((payload) => payload?.lesson || null).catch(() => null) : Promise.resolve(null),
    fetch(`/api/parent/portfolio?code=${encodeURIComponent(accessCode)}`).then(async (response) => { const payload = await response.json(); return response.ok && payload.ok ? { items: payload.items || [], failed: false } : { items: [], failed: true }; }).catch(() => ({ items: [], failed: true })),
    fetch(`/api/parent/weekly-tasks?code=${encodeURIComponent(accessCode)}`).then<WeeklyTaskState>(async (response) => response.ok ? response.json() as Promise<WeeklyTaskState> : {}).catch((): WeeklyTaskState => ({})),
  ]);
  lastFetchCode = accessCode; cachedLesson = lessonResult; cachedPortfolio = portfolioResult.items; cachedPortfolioFailed = portfolioResult.failed; cachedTasks = new Set(tasksResult.completed_task_ids || []);
  renderAll(data, accessCode, cachedLesson, cachedPortfolio, new Set(cachedTasks), cachedPortfolioFailed);
}

export function invalidateParentCache() { lastFetchCode = ''; cachedLesson = null; cachedPortfolio = []; cachedTasks = new Set(); cachedPortfolioFailed = false; }
