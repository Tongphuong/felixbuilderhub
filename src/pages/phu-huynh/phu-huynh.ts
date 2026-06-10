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

function renderDashboard(data: ProgressPayload, lesson: LessonPayload['lesson'] | null, code: string) {
  const progress = (data.progress || {}) as Record<string, unknown>;
  const read2LeadState = (data.read2lead_state || {}) as Record<string, unknown>;
  const storyProgress = (data.story_progress || {}) as Record<string, unknown>;
  const weeklyGrowth = (data.weekly_growth || {}) as Record<string, unknown>;
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

    qs('#parent-session')?.classList.remove('hidden');
    const masked = qs('#parent-code-display');
    if (masked) masked.textContent = code;

    renderDashboard(data, lesson, code);

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
