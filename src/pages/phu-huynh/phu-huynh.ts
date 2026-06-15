import { normalizeLearningMetrics } from '../../lib/learning-metrics';

type ProgressPayload = {
  ok?: boolean;
  message?: string;
  state?: string;
  progress?: Record<string, unknown>;
  read2lead_state?: Record<string, unknown>;
  story_progress?: Record<string, unknown>;
  weekly_growth?: Record<string, unknown>;
};

type LessonPayload = {
  ok?: boolean;
  lesson?: {
    story?: { title?: string };
    topic?: string;
    level_label?: string;
    parent_note_vi?: string;
    next_suggestion_vi?: string;
    activities?: unknown[];
  };
};

type PortfolioEntry = {
  id: string;
  ts?: string;
  size?: number;
  content_type?: string;
  title?: string;
  note_vi?: string;
  parent_seen_at?: string | null;
  reactions?: {
    heart?: number;
    clap?: number;
    strong?: number;
  };
  video_url?: string;
};

type PortfolioPayload = {
  ok?: boolean;
  message?: string;
  items?: PortfolioEntry[];
};

function qs<T extends Element = Element>(sel: string) {
  return document.querySelector<T>(sel);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatLevel(level: unknown) {
  const raw = String(level || 'L1');
  const match = raw.match(/^L(\d+)$/i);
  return match ? `Cấp ${match[1]}` : raw;
}

function packStatusLabel(state: string, pack: Record<string, unknown> | null | undefined) {
  if (!pack) return 'Chưa có bài';
  if (state === 'generation_in_progress' || pack.status === 'generation_in_progress') return 'Đang tạo bài';
  if (String(pack.status || '').includes('reviewed_pass')) return 'Đã hoàn thành';
  const steps = (pack.web_lesson_steps as Record<string, unknown>) || {};
  if (steps.read_completed_at) return 'Đang làm bài tập';
  if (steps.listen_completed_at) return 'Đang nghe / đọc';
  return 'Sẵn sàng làm bài';
}

function buildWeeklyTasks(data: ProgressPayload, lesson: LessonPayload['lesson'] | null) {
  const tasks: string[] = [];
  const growth = (data.weekly_growth || {}) as Record<string, unknown>;
  const thisWeek = Number(growth.this_week_packs || 0);
  const pack = (data.progress as Record<string, unknown>)?.current_pack as Record<string, unknown> | undefined;
  const state = data.state || '';

  if (state === 'generation_in_progress') {
    tasks.push('Hệ thống đang viết truyện — đợi khoảng 1–2 phút rồi mở lại trang.');
  } else if (!pack) {
    tasks.push('Nhắc con vào Nhà của con để chọn chủ đề và tạo bài đầu tiên.');
  } else if (!String(pack.status || '').includes('reviewed_pass')) {
    tasks.push(`Nhắc con tiếp tục bài "${String(pack.story_title || 'đang mở')}".`);
  }

  if (thisWeek < 2) {
    tasks.push(`Tuần này mới ${thisWeek} truyện — khuyến khích con học thêm 1–2 buổi ngắn.`);
  } else {
    tasks.push(`Tuần này con đã học ${thisWeek} truyện — giữ nhịp đều nhé.`);
  }

  const streak = Number((data.read2lead_state as Record<string, unknown>)?.streak_days || 0);
  if (streak >= 1) {
    tasks.push(`Streak ${streak} ngày — ca ngày mai con vào làm 1 bài là giữ được.`);
  }

  if (lesson?.next_suggestion_vi) {
    tasks.push(String(lesson.next_suggestion_vi));
  }

  return tasks.slice(0, 4);
}

function renderGrowthSection(weeklyGrowth: Record<string, unknown>) {
  const weeks = Array.isArray(weeklyGrowth.weeks) ? weeklyGrowth.weeks : [];
  if (!weeks.length) return '<p class="parent-muted">Chưa đủ dữ liệu tuần.</p>';

  const bars = weeks
    .map((week: Record<string, unknown>) => {
      const height = Number(week.bar_percent || 0);
      return `
        <div class="parent-growth-bar">
          <span class="parent-growth-value">${escapeHtml(week.bar_label || '0')}</span>
          <div class="parent-growth-track" aria-hidden="true">
            <span class="parent-growth-fill ${week.is_current ? 'parent-growth-fill--current' : ''}" style="height: ${height}%"></span>
          </div>
          <span class="parent-growth-label">${escapeHtml(week.label_vi || '')}</span>
        </div>
      `;
    })
    .join('');

  return `
    <p class="parent-muted">${escapeHtml(weeklyGrowth.headline || '')}</p>
    <div class="parent-growth-bars" role="img" aria-label="Số truyện mỗi tuần">${bars}</div>
  `;
}

function renderLearningQualitySection(rawMetrics: unknown) {
  const metrics = normalizeLearningMetrics(rawMetrics);
  const summary = metrics['7day_summary'];
  const firstTryPercent = Math.round(summary.first_try_pass_rate * 100);
  const attention = Math.round(summary.avg_attention_score || 0);
  const retry = Number(summary.avg_retry_count || 0).toFixed(1);
  const recent = metrics.packs_history.slice(0, 7);
  const bars = recent.length
    ? recent.map((entry) => {
        const value = Math.max(4, Math.min(100, Math.round(entry.attention_score || 0)));
        return `
          <div class="parent-quality-bar">
            <span class="parent-quality-fill ${entry.suspect ? 'parent-quality-fill--warn' : ''}" style="height: ${value}%"></span>
          </div>
        `;
      }).join('')
    : '<p class="parent-muted text-sm">Chưa đủ dữ liệu nói trong 7 ngày.</p>';
  const alert = attention > 0 && attention < 50
    ? '<p class="parent-quality-alert">Chú ý: 7 ngày gần đây con dễ mất tập trung khi làm phần nghe/nói.</p>'
    : '';

  return `
    <section class="parent-section" data-learning-quality>
      <h2 class="parent-section__title">Chất lượng luyện nói 7 ngày</h2>
      ${alert}
      <div class="parent-stat-grid">
        <div class="parent-stat">
          <p class="parent-stat__value">${firstTryPercent}%</p>
          <p class="parent-stat__label">Qua lần đầu</p>
        </div>
        <div class="parent-stat">
          <p class="parent-stat__value">${retry}</p>
          <p class="parent-stat__label">Lần thử lại</p>
        </div>
        <div class="parent-stat">
          <p class="parent-stat__value">${attention}</p>
          <p class="parent-stat__label">Tập trung</p>
        </div>
      </div>
      <div class="parent-quality-bars" role="img" aria-label="Điểm tập trung từng bài">${bars}</div>
      ${
        summary.suspect_count
          ? `<p class="parent-muted mt-2 text-sm">${summary.suspect_count} bài làm quá nhanh, phụ huynh nên xem lại cùng con.</p>`
          : '<p class="parent-muted mt-2 text-sm">Không thấy dấu hiệu bấm quá nhanh trong 7 ngày.</p>'
      }
    </section>
  `;
}

function renderStoryList(storyProgress: Record<string, unknown>) {
  const stories = Array.isArray(storyProgress.stories) ? storyProgress.stories : [];
  if (!stories.length) {
    return '<p class="parent-muted">Chưa có truyện hoàn thành — bình thường nếu con mới bắt đầu.</p>';
  }
  return stories
    .slice(0, 6)
    .map(
      (story: Record<string, unknown>) => `
        <div class="parent-story-row">
          <span aria-hidden="true">${escapeHtml(story.emoji || '📖')}</span>
          <div class="min-w-0">
            <p class="font-semibold">${escapeHtml(story.title || 'Truyện')}</p>
            <p class="parent-muted text-xs">${escapeHtml([story.level ? formatLevel(story.level) : '', story.topic].filter(Boolean).join(' · '))}</p>
          </div>
        </div>
      `,
    )
    .join('');
}

function formatPortfolioDate(value: unknown) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

function reactionCount(item: PortfolioEntry, kind: 'heart' | 'clap' | 'strong') {
  return Math.min(99, Math.max(0, Number(item.reactions?.[kind]) || 0));
}

function renderPortfolioSection(items: PortfolioEntry[], loadFailed: boolean) {
  let content = '';
  if (loadFailed) {
    content = '<p class="parent-muted">Chưa tải được video. Vui lòng thử lại sau ít phút.</p>';
  } else if (!items.length) {
    content = '<p class="parent-muted">Chưa có video nào. Thầy sẽ gửi video và nhận xét sau buổi học nhé.</p>';
  } else {
    content = items
      .map((item) => {
        const id = escapeHtml(item.id);
        return `
          <article id="video-${id}" class="parent-video-card" data-portfolio-card="${id}">
            <div class="flex items-start justify-between gap-3">
              <h3 class="font-semibold text-[#1e2a4a]">${escapeHtml(item.title || 'Video buổi học')}</h3>
              <time class="parent-muted shrink-0 text-xs" datetime="${escapeHtml(item.ts || '')}">${escapeHtml(formatPortfolioDate(item.ts))}</time>
            </div>
            <video
              class="parent-video mt-3"
              controls
              playsinline
              preload="metadata"
              src="${escapeHtml(item.video_url || '')}"
              data-portfolio-id="${id}"
            ></video>
            ${
              item.note_vi
                ? `<p class="mt-3 text-sm leading-relaxed text-[#1e2a4a]">${escapeHtml(item.note_vi)}</p>`
                : ''
            }
            <div class="parent-reactions mt-3" aria-label="Gửi cảm xúc">
              <button type="button" class="parent-reaction" data-reaction-kind="heart" data-portfolio-id="${id}" aria-label="Thả tim">
                <span aria-hidden="true">❤️</span>
                <span data-reaction-count="heart">${reactionCount(item, 'heart')}</span>
              </button>
              <button type="button" class="parent-reaction" data-reaction-kind="clap" data-portfolio-id="${id}" aria-label="Vỗ tay">
                <span aria-hidden="true">👏</span>
                <span data-reaction-count="clap">${reactionCount(item, 'clap')}</span>
              </button>
              <button type="button" class="parent-reaction" data-reaction-kind="strong" data-portfolio-id="${id}" aria-label="Cố lên">
                <span aria-hidden="true">💪</span>
                <span data-reaction-count="strong">${reactionCount(item, 'strong')}</span>
              </button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  return `
    <section class="parent-section" data-portfolio-section>
      <h2 class="parent-section__title">🎬 Video & nhận xét của thầy</h2>
      <div class="space-y-4">${content}</div>
      <p class="parent-portfolio-status parent-muted mt-3 hidden text-xs" aria-live="polite"></p>
    </section>
  `;
}

function attachPortfolioInteractions(root: Element, code: string) {
  const seenIds = new Set<string>();
  root.querySelectorAll<HTMLVideoElement>('video[data-portfolio-id]').forEach((video) => {
    video.addEventListener(
      'play',
      () => {
        const id = video.dataset.portfolioId || '';
        if (!id || seenIds.has(id)) return;
        seenIds.add(id);
        void fetch('/api/parent/portfolio-seen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, id }),
          keepalive: true,
        }).catch(() => {
          seenIds.delete(id);
        });
      },
      { once: true },
    );
  });

  root.querySelectorAll<HTMLButtonElement>('button[data-reaction-kind]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.portfolioId || '';
      const kind = button.dataset.reactionKind as 'heart' | 'clap' | 'strong' | undefined;
      const count = button.querySelector<HTMLElement>(`[data-reaction-count="${kind || ''}"]`);
      if (!id || !kind || !count || button.disabled) return;

      const previous = Math.min(99, Math.max(0, Number(count.textContent) || 0));
      count.textContent = String(Math.min(99, previous + 1));
      button.disabled = true;

      try {
        const response = await fetch('/api/parent/portfolio-react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, id, kind }),
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          reactions?: Record<string, number>;
        };
        if (!response.ok || !payload.ok) throw new Error('reaction_failed');
        count.textContent = String(Math.min(99, Math.max(0, Number(payload.reactions?.[kind]) || 0)));
      } catch {
        count.textContent = String(previous);
        const status = root.querySelector<HTMLElement>('.parent-portfolio-status');
        if (status) {
          status.textContent = 'Chưa gửi được cảm xúc. Vui lòng thử lại.';
          status.classList.remove('hidden');
        }
      } finally {
        button.disabled = false;
      }
    });
  });

  const hash = window.location.hash;
  if (hash.startsWith('#video-')) {
    window.requestAnimationFrame(() => {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function renderDashboard(
  data: ProgressPayload,
  lesson: LessonPayload['lesson'] | null,
  code: string,
  portfolioItems: PortfolioEntry[],
  portfolioLoadFailed: boolean,
) {
  const progress = (data.progress || {}) as Record<string, unknown>;
  const read2LeadState = (data.read2lead_state || {}) as Record<string, unknown>;
  const storyProgress = (data.story_progress || {}) as Record<string, unknown>;
  const weeklyGrowth = (data.weekly_growth || {}) as Record<string, unknown>;
  const learningMetrics = read2LeadState.learning_metrics;
  const pack = progress.current_pack as Record<string, unknown> | undefined;
  const tasks = buildWeeklyTasks(data, lesson);

  const root = qs('#parent-dashboard');
  if (!root) return;

  root.innerHTML = `
    <section class="parent-section">
      <h2 class="parent-section__title">Tóm tắt</h2>
      <div class="parent-stat-grid">
        <div class="parent-stat">
          <p class="parent-stat__value" data-clarity-mask="true">${escapeHtml(formatLevel(read2LeadState.current_level || progress.current_level))}</p>
          <p class="parent-stat__label">Cấp đọc</p>
        </div>
        <div class="parent-stat">
          <p class="parent-stat__value">${Number(read2LeadState.streak_days || 0)}</p>
          <p class="parent-stat__label">Ngày liên tiếp</p>
        </div>
        <div class="parent-stat">
          <p class="parent-stat__value">${Number(storyProgress.total_completed ?? progress.completed_packs ?? 0)}</p>
          <p class="parent-stat__label">Truyện xong</p>
        </div>
      </div>
      <p class="parent-muted mt-3 text-sm" data-clarity-mask="true">Học sinh: <strong>${escapeHtml(String(progress.student_name || '—'))}</strong></p>
    </section>

    <section class="parent-section">
      <h2 class="parent-section__title">Bài đang học</h2>
      ${
        pack
          ? `<p class="font-semibold">${escapeHtml(String(pack.story_title || 'Bài đang mở'))}</p>
             <p class="parent-muted text-sm mt-1">${escapeHtml(packStatusLabel(data.state || '', pack))} · ${escapeHtml(String(pack.topic || ''))}</p>
             ${lesson?.parent_note_vi ? `<p class="mt-3 text-sm leading-relaxed">${escapeHtml(lesson.parent_note_vi)}</p>` : ''}`
          : '<p class="parent-muted">Chưa có bài nào đang mở.</p>'
      }
    </section>

    <section class="parent-section">
      <h2 class="parent-section__title">Tiến bộ theo tuần</h2>
      ${renderGrowthSection(weeklyGrowth)}
    </section>

    ${renderLearningQualitySection(learningMetrics)}

    <section class="parent-section parent-section--highlight">
      <h2 class="parent-section__title">Việc cho tuần này</h2>
      <ul class="parent-task-list">
        ${tasks.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
    </section>

    <section class="parent-section">
      <h2 class="parent-section__title">Truyện đã học</h2>
      ${renderStoryList(storyProgress)}
    </section>

    ${renderPortfolioSection(portfolioItems, portfolioLoadFailed)}

    <section class="parent-section">
      <h2 class="parent-section__title">Liên hệ</h2>
      <p class="parent-muted text-sm leading-relaxed">Cần đổi lịch hoặc hỏi Felix — nhắn Zalo hoặc đặt lịch coaching.</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <a href="/coaching#book" class="parent-btn parent-btn--primary">Đặt lịch coaching</a>
        <a href="/hoc-sinh?code=${encodeURIComponent(code)}" class="parent-btn">Nhà của con →</a>
      </div>
    </section>
  `;
  root.classList.remove('hidden');
  attachPortfolioInteractions(root, code);
}

async function loadParentDashboard() {
  const err = qs('#parent-error');
  const dash = qs('#parent-dashboard');
  const input = qs<HTMLInputElement>('#parent-code');
  const code = (input?.value || '').trim().toUpperCase();
  if (!code) {
    if (err) {
      err.textContent = 'Vui lòng nhập mã học sinh.';
      err.classList.remove('hidden');
    }
    return;
  }

  const btn = qs<HTMLButtonElement>('#parent-load');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Đang tải...';
  }
  err?.classList.add('hidden');
  dash?.classList.add('hidden');

  try {
    const res = await fetch(`/api/read2lead-progress?code=${encodeURIComponent(code)}`);
    const data = (await res.json()) as ProgressPayload;
    if (!res.ok || !data.ok) {
      if (err) {
        err.textContent = data.message || 'Không tìm thấy mã.';
        err.classList.remove('hidden');
      }
      return;
    }

    const portfolioPromise = fetch(`/api/parent/portfolio?code=${encodeURIComponent(code)}`)
      .then(async (response) => ({
        response,
        payload: (await response.json()) as PortfolioPayload,
      }))
      .catch(() => null);
    let lesson: LessonPayload['lesson'] | null = null;
    const pack = (data.progress as Record<string, unknown>)?.current_pack as Record<string, unknown> | undefined;
    const packId = pack?.pack_id;
    if (packId && pack.status !== 'generation_in_progress') {
      const lessonRes = await fetch(
        `/api/read2lead-lesson?code=${encodeURIComponent(code)}&pack_id=${encodeURIComponent(String(packId))}`,
      );
      const lessonData = (await lessonRes.json()) as LessonPayload;
      if (lessonRes.ok && lessonData.ok) lesson = lessonData.lesson || null;
    }

    let portfolioItems: PortfolioEntry[] = [];
    let portfolioLoadFailed = false;
    const portfolioResult = await portfolioPromise;
    if (!portfolioResult || !portfolioResult.response.ok || !portfolioResult.payload.ok) {
      portfolioLoadFailed = true;
    } else {
      portfolioItems = Array.isArray(portfolioResult.payload.items) ? portfolioResult.payload.items : [];
    }

    qs('#parent-session')?.classList.remove('hidden');
    const masked = qs('#parent-code-display');
    if (masked) masked.textContent = code;

    renderDashboard(data, lesson, code, portfolioItems, portfolioLoadFailed);

    const url = new URL(window.location.href);
    url.searchParams.set('code', code);
    window.history.replaceState({}, '', url);
  } catch {
    if (err) {
      err.textContent = 'Mạng không ổn định. Vui lòng thử lại.';
      err.classList.remove('hidden');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Xem tiến độ';
    }
  }
}

export function initPhuHuynh() {
  const params = new URLSearchParams(window.location.search);
  const initial = params.get('code');
  if (initial) {
    const input = qs<HTMLInputElement>('#parent-code');
    if (input) input.value = initial.toUpperCase();
    void loadParentDashboard();
  }

  qs('#parent-load')?.addEventListener('click', () => void loadParentDashboard());
  qs('#parent-change-code')?.addEventListener('click', () => {
    qs('#parent-entry')?.classList.remove('hidden');
    qs('#parent-session')?.classList.add('hidden');
    qs('#parent-dashboard')?.classList.add('hidden');
    const input = qs<HTMLInputElement>('#parent-code');
    if (input) {
      input.value = '';
      input.focus();
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url);
  });

  const input = qs<HTMLInputElement>('#parent-code');
  input?.addEventListener('paste', () => {
    setTimeout(() => {
      if (input) input.value = input.value.trim().toUpperCase();
    }, 0);
  });
}
