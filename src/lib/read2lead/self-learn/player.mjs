import { publisherPayload, isPublisherLesson, filterPublisherCards } from './publisher-client.mjs';
import { NarrationLifecycle } from './narration-lifecycle.mjs';
import { GiftClient } from './gift-client.mjs';
import { FamilyClient } from './family-client.mjs';
import { GameClient } from './game-client.mjs';
import { acceptGame } from './game-contract.mjs';
import { renderGameAvatar } from './game-avatar.mjs';
import { LibraryClient } from './library-client.mjs';
import { HistoryClient } from './history-client.mjs';
import { ApiClient, ApiError, SessionClient } from './api-client.mjs';
import { openPendingStore } from './pending-store.mjs';
import { CaptureLifecycle } from './media-lifecycle.mjs';
import { renderPlayer } from './player-views.mjs';
import { validId } from './session-contract.mjs';
import { pictureOrderText, retellPictures } from './level-presentation.mjs';
const MESSAGES = {
  history_load_failed: 'Chưa tải xong lịch sử. Những lượt đã lưu vẫn được giữ. Con có thể thử lại.',
  gift_pending: 'Con còn một lượt quà đang giữ. Mình đối chiếu hoặc gửi lại đúng lượt cũ trước nhé.',
  gift_refresh_required: 'Con mở góc quà để xem số dư đã lưu nhé.',
  gift_confirmation_required: 'Con xem lại món mẫu và giá trước khi xác nhận nhé.',
  gift_confirmation_changed: 'Món mẫu hoặc giá vừa thay đổi. Con xem dữ liệu mới rồi chọn lại nhé.',
  gift_changed: 'Món mẫu đã đổi phiên bản hoặc giá. Con cập nhật rồi đối chiếu lượt đang giữ nhé.',
  gift_unavailable: 'Món mẫu đang tạm nghỉ. Mục tiêu và kim cương của con vẫn được giữ.',
  insufficient_funds: 'Số dư vừa cập nhật chưa đủ cho lượt này. Con có thể tiếp tục giữ mục tiêu.',
  gift_reconcile_required: 'Con xem dữ liệu đã lưu và đối chiếu lượt cũ trước nhé.',
  gift_storage_invalid: 'Bản đang giữ trên máy chưa đọc được. Con xem lịch sử trước khi bỏ bản lỗi nhé.',
  gift_storage_changed: 'Bản đang giữ đã đổi trên thẻ trình duyệt. Con tải lại để đối chiếu nhé.',
  gift_scope_expired: 'Hồ sơ đã đổi. Con mở lại góc quà để xem đúng dữ liệu nhé.',
  game_pending: 'Con còn lựa chọn đang giữ. Mình xem dữ liệu đã lưu hoặc gửi lại lượt cũ trước nhé.',
  game_scope_expired: 'Màn hình đã đổi. Con mở lại bạn đồng hành để xem đúng hồ sơ nhé.',
  game_reconcile_required: 'Con xem lựa chọn đã lưu trước khi bỏ bản đang giữ nhé.',
  game_pending_changed: 'Bản đang giữ trên máy đã đổi. Con tải lại để đối chiếu nhé.',
  game_draft_missing: 'Con chọn một phần hoặc màu trước khi lưu nhé.',
  game_refresh_required: 'Con mở lại bạn đồng hành để tải dữ liệu đã lưu nhé.',
  game_saved_refresh_needed: 'Bạn đồng hành đã được lưu. Chưa tải được lịch sử mới nhất; con thử xem lựa chọn đã lưu nhé.',
  library_pending: 'Con còn một thay đổi thư viện chưa được xác nhận. Mình gửi lại hoặc xem dữ liệu đã lưu trước nhé.',
  library_scope_expired: 'Màn hình đã đổi. Con mở lại thư viện để xem dữ liệu đã lưu nhé.',
  library_reconcile_required: 'Con xem dữ liệu đã lưu trước khi bỏ lượt đang giữ nhé.',
  library_pending_changed: 'Lượt đang giữ đã thay đổi. Con tải lại thư viện để đối chiếu nhé.',
  library_storage_invalid: 'Lượt thư viện đang giữ trên máy chưa đọc được. Con xem dữ liệu đã lưu rồi bỏ bản đang giữ bị lỗi nhé. Bài đã lưu trên máy chủ vẫn còn.',
  library_saved_refresh_needed: 'Thay đổi thư viện đã lưu. Chưa tải được màn hình mới nhất; con thử xem dữ liệu đã lưu nhé.',
  too_many_interests: 'Con chọn tối đa 3 điều mình thích nhé. Con cũng có thể để trống.',
  reading_not_found: 'Chưa tìm thấy lượt đọc này trong hồ sơ đang chọn. Con về thư viện để chọn lại nhé.',
  reading_finished: 'Lượt đọc này đã được đánh dấu xong. Con xem lại dữ liệu đã lưu hoặc mở một lượt đọc lại nhé.',
  content_unavailable: 'Câu chuyện này chưa mở được lúc này. Lượt đã lưu vẫn được giữ; con chọn một câu chuyện khác nhé.',
  invalid_access: 'Mã hoặc mật khẩu chưa đúng. Anh chị kiểm tra lại thông tin của gia đình mẫu nhé.',
  family_saved_refresh_needed: 'Thay đổi đã được lưu. Chưa tải được hồ sơ mới nhất; anh chị kiểm tra lại nhé.',
  parent_required: 'Quyền phụ huynh đã đóng. Anh chị nhập lại mật khẩu để tiếp tục nhé.',
  child_access_disabled: 'Hồ sơ này chưa được mở học hoặc đã được cất. Bài đã lưu vẫn còn; anh chị kiểm tra trong khu vực phụ huynh nhé.',
  recording_disabled: 'Micro đang được tắt cho hồ sơ này. Con vẫn có thể gõ ý của mình và tiếp tục.',
  child_limit: 'Gia đình mẫu đã có đủ 10 hồ sơ. Anh chị có thể mở lại hồ sơ đã cất.',
  last_active_child: 'Gia đình cần giữ ít nhất một hồ sơ chưa cất. Anh chị có thể tắt quyền học của hồ sơ này.',
  invalid_request: 'Một mục chưa hợp lệ. Anh chị kiểm tra tên, mã và các lựa chọn rồi thử lại nhé.',
  access_conflict: 'Mã gia đình này đã được dùng. Anh chị chọn một mã khác nhé.',
  credential_unchanged: 'Anh chị chọn cả ba mã mới khác với bộ mã hiện tại nhé.',
  family_pending: 'Còn một yêu cầu chưa được xác nhận. Anh chị gửi lại đúng yêu cầu hoặc kiểm tra dữ liệu đã lưu trước nhé.',
  family_scope_expired: 'Màn hình đã đổi. Anh chị kiểm tra dữ liệu đã lưu trước khi thử lại.',
  connection_lost: 'Chưa kết nối được máy chủ. Lượt đang gửi vẫn được giữ để con thử lại.',
  request_timeout: 'Máy chủ chưa trả lời kịp. Con có thể kiểm tra tiến độ hoặc thử gửi lại.',
  unauthorized: 'Phiên truy cập đã kết thúc. Anh chị nhập lại mã của gia đình mẫu nhé.',
  access_expired: 'Mã truy cập đã hết phiên. Anh chị vào lại để tiếp tục nhé.',
  wrong_child: 'Hồ sơ đang chọn đã thay đổi. Con về hành trình để chọn đúng bài của mình nhé.',
  csrf_failed: 'Phiên truy cập đã đổi ở cửa sổ khác. Anh chị vào lại bằng mã gia đình mẫu nhé.',
  stale_revision: 'Bài này đã có tiến độ mới. Con xem lại lượt đang giữ trước khi tiếp tục nhé.',
  request_conflict: 'Lượt gửi này cần được đối chiếu. Con kiểm tra tiến độ trước khi tiếp tục nhé.',
  pending_exists: 'Con còn một lượt chưa được xác nhận. Mình gửi lại lượt đó trước nhé.',
  scope_expired: 'Hồ sơ này đã thoát ở cửa sổ khác. Con tải lại rồi vào bằng mã mẫu nhé.',
  rate_limited: 'Mình đã thử nhiều lần. Con đợi một phút rồi thử lại nhé.',
  storage_unavailable: 'Chỗ lưu trên máy chưa sẵn sàng. Con tải lại và cho phép lưu dữ liệu của trang nhé.',
  incomplete_picture_order: 'Con chọn đủ ba tranh, mỗi tranh một lần nhé. Hoặc để trống cả ba nếu con chỉ muốn gõ lời kể.',
};
export async function mountPlayer(root) {
  if (!root) return;
  const api = new ApiClient();
  const state = { access: null, client: null, loading: true, busy: false, message: '', error: false, filter: '', lessons: [], sessions: [], screen: 'learning', family: null, familyAudit: [], recoveryFamily: 'synthetic-family-a', libraryClient: null, historyClient: null, historyFocus: null, libraryCatalogue: [], libraryLessons: [], librarySessions: [], libraryFilters: { level: '', interest: '', favorites: false }, libraryHistoryCount: 10, giftClient: null, giftHistoryCount: 10, gameClient: null, homeGame: null, gameSlot: 'body', gamePage: 0 };
  let cache, scope, generation = 0, renderedKey = '', captureStatus = 'not_attempted', captureMessage = '', captureToken = 0;
  let browserStorage; try { browserStorage = sessionStorage; } catch {}
  const familyClient = new FamilyClient({ api, storage: browserStorage });
  const knownChildren = new Set();
  const drafts = new Map();
  let narration=null,narrationKey='',positionedReadingKey='';
  state.publisherFilters={query:'',collection:'',month:''};
  const oralLesson=()=>isPublisherLesson(state.client?.view?.lesson);
  let captureChecking = false, captureTimer = null, parentTimer = null;
  const activityKey = () => { if (state.screen === 'gifts') return state.giftClient?.confirmation ? 'gifts:confirm' : 'gifts'; if (state.screen === 'game') return 'game'; if (state.screen === 'library') return 'library'; if (state.screen === 'free-reading') return 'free-reading:' + (state.libraryClient?.view?.reading.reading_id || ''); const v = state.client?.view, s = v?.session; return s ? [s.session_id, s.stage, s.question_cursor, s.dialogue_cursor, v.retell_received, s.repair_state, s.followup_state].join(':') : 'home'; };
  function rememberDraft() {
    const form = root.querySelector('form[data-event]');
    if (form && renderedKey) drafts.set(renderedKey, [...form.elements].filter(el => el.name && ['INPUT','SELECT','TEXTAREA'].includes(el.tagName)).map(el => ({ name: el.name, value: el.value, checked: el.checked })));
  }
  function paint(focus = false) {
    rememberDraft();
    const key = activityKey();
    if (state.screen !== 'free-reading') positionedReadingKey = '';
    const changedActivity = key !== renderedKey;
    if (changedActivity) { captureToken++; capture.cancel('interrupted'); captureStatus = 'not_attempted'; captureMessage = ''; }
    renderedKey = key;
    const active = document.activeElement, activeId = active?.id;
    state.familyPending = familyClient.pending;
    state.recoveryUnfinished = familyClient.unfinished('recover', state.recoveryFamily);
    state.createUnfinished = state.family ? familyClient.unfinished('parent/create-child', state.family.family_id) : false;
    state.familyUnfinished = state.family?.children.filter(c => familyClient.unfinished('parent/update-child', c.id)).map(c => c.id) || [];
    root.innerHTML = renderPlayer(state);
    const heading = root.querySelector('#activity h2');
    if (heading) { heading.id = 'activity-heading'; heading.tabIndex = -1; }
    const form = root.querySelector('form[data-event]');
    if (form && drafts.has(key)) for (const saved of drafts.get(key)) {
      const fields = [...form.elements].filter(el => el.name === saved.name);
      for (const field of fields) { if (['checkbox', 'radio'].includes(field.type)) { if (field.value === saved.value) field.checked = saved.checked; } else field.value = saved.value; }
    }
    const pending = !!state.client?.row?.pending;
    for (const field of root.querySelectorAll('[data-submission]')) field.disabled = state.busy || pending;
    for (const control of root.querySelectorAll('button, select, input, textarea')) {
      if (!['narration-pause','stop-microphone'].includes(control.dataset.action) && (state.busy || (pending && !['retry', 'refresh-session', 'discard', 'home', 'logout'].includes(control.dataset.action) && control.id !== 'child-select'))) control.disabled = true;
      if ((state.libraryClient?.pending || state.libraryClient?.storageInvalid) && (control.closest('#library-interests-form, #free-position-form') || ['library-read', 'library-favorite', 'start'].includes(control.dataset.action))) control.disabled = true;
    }
    updateCapture();
    syncNarration();
    paintGamePreviews();
    if (state.screen === 'free-reading') {
      const bookmark = root.querySelector('.free-reader [data-free-sentence].is-bookmark');
      if (bookmark) bookmark.tabIndex = -1;
    }
    if (state.screen === 'library' && !state.busy && state.historyFocus) {
      const target = root.querySelector('#' + CSS.escape(state.historyFocus)); state.historyFocus = null;
      if (target) { if (target.tagName === 'H2') target.tabIndex = -1; target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', behavior: 'instant' }); }
    }
    else if (state.screen === 'free-reading' && key !== positionedReadingKey) {
      const view = state.libraryClient?.view;
      const savedId = view?.reading.sentence_id;
      const title = root.querySelector('#free-reader-heading');
      const target = savedId && savedId !== view?.lesson.story.sentences[0]?.id
        ? root.querySelector('#free-sentence-' + CSS.escape(savedId)) || title : title;
      if (target) {
        positionedReadingKey = key;
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    }
    else if (changedActivity && state.screen === 'gifts') root.querySelector(state.giftClient?.confirmation ? '#gift-confirm-heading' : '#gift-heading')?.focus();
    else if (changedActivity && heading) heading.focus();
    else if (focus && state.screen !== 'free-reading') root.querySelector('#main')?.focus();
    else if (activeId) root.querySelector('#' + CSS.escape(activeId))?.focus({ preventScroll: state.screen === 'free-reading' });
  }
  function disposeNarration() {
    const previous=narration;narration=null;narrationKey='';previous?.dispose();
  }
  function updateNarration(snapshot=narration?.snapshot) {
    if(!snapshot)return;
    const status=root.querySelector('#narration-status'),seek=root.querySelector('#narration-seek');
    const labels={loading:'Loading audio…',playing:'Playing',paused:'Paused',buffering:'Waiting for audio…',ended:'Audio finished',error:'Audio could not play. Reload audio to try again.',empty:'Ready to listen.'};
    if(status)status.textContent=(labels[snapshot.state]||'Audio stopped')+' '+Math.floor(snapshot.position_seconds)+' / '+Math.ceil(snapshot.duration_seconds)+' s';
    if(seek)seek.value=String(snapshot.position_seconds);
  }
  function syncNarration() {
    const lesson=state.screen==='free-reading'?state.libraryClient?.view?.lesson:state.client?.view?.lesson;
    if(!root.querySelector('[data-narration]')||!lesson?.audio?.available){disposeNarration();return;}
    const key=activityKey()+':'+lesson.audio.url+':'+lesson.version;
    if(key!==narrationKey){disposeNarration();narrationKey=key;narration=new NarrationLifecycle({audio:new Audio(),document,onChange:updateNarration});narration.load(lesson.audio);}
    updateNarration();
  }
  async function playNarration(action,segment) {
    const controller=narration,key=narrationKey,client=state.client;
    if(!controller)return;
    if(action==='narration-retry'){controller.retry();return;}
    // Reserve listening support before sound can play. A failed or interrupted request
    // cannot let audible assistance be recorded later as independent reading.
    if(client?.view.session.stage==='input'&&!client.view.session.input_audio_used){
      await submit('audio_started',{});
      if(client!==state.client||client.row?.pending||!client.view.session.input_audio_used||key!==narrationKey)return;
    }
    if(action==='narration-replay')controller.seek(0);
    if(capture.state==='recording'||capture.state==='requesting')capture.cancel('interrupted');
    await controller.play(action==='narration-segment'?segment:null);
  }
  function applyPublisherFilters(){state.libraryLessons=filterPublisherCards(state.libraryServerLessons||[],state.publisherFilters);}
  function paintGamePreviews() {
    for (const target of root.querySelectorAll('[data-game-preview]')) {
      const monster = target.dataset.gamePreview === 'builder' ? state.gameClient?.monster : target.dataset.gamePreview === 'saved' ? state.gameClient?.game?.preferences.monster : state.homeGame?.preferences.monster;
      if (monster) void renderGameAvatar(target,monster);
    }
  }
  function updateCapture() {
    const status = root.querySelector('#capture-status'), start = root.querySelector('#microphone'), stop = root.querySelector('#stop-microphone');
    if (status && captureMessage) status.textContent = oralLesson() ? (capture.state==='recording'?'Microphone test in progress. Up to 60 seconds; audio is not sent.':captureChecking?'Checking microphone permission…':'The microphone is optional. Speak aloud, use an optional answer choice, or skip. Speech has not been assessed; no recording is kept.') : captureMessage;
    if (start) { start.hidden = capture.state === 'recording'; start.disabled = state.busy || !!state.client?.row?.pending || capture.state === 'requesting' || captureChecking || state.access?.children.find(c => c.id === state.access.active_child_id)?.recording_allowed === false; }
    if (stop) stop.hidden = capture.state !== 'recording';
    if (status && !captureMessage && state.access?.children.find(c => c.id === state.access.active_child_id)?.recording_allowed === false) status.textContent = oralLesson() ? 'The microphone is off for this profile. You can speak aloud, use an optional answer choice, or skip.' : MESSAGES.recording_disabled;
  }
  // Browser timer methods require their Window receiver; wrappers also keep injected capture tests portable.
  const capture = new CaptureLifecycle({ setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: id => clearTimeout(id), getUserMedia: async constraints => {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    try { await verifyCapture(); return stream; } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
  }, onResult(result) {
    // Discard the Blob immediately. There is no raw-audio upload or durable audio store in local QA.
    clearTimeout(captureTimer); captureTimer = null;
    captureStatus = result.blob ? 'provider_failed' : 'missing';
    captureMessage = result.blob ? 'Đã thử micro và bỏ bản ghi. Chưa có bộ chấm giọng nói; con vẫn có thể gõ ý của mình.' : 'Lượt ghi đã dừng, không giữ âm thanh. Con có thể thử lại hoặc gõ ý của mình.';
    updateCapture();
  } });
  function setSessionURL(id) { const url = new URL(location.href); url.searchParams.delete('view'); url.searchParams.delete('reading'); if (id) url.searchParams.set('session', id); else url.searchParams.delete('session'); history.replaceState(null, '', url); }
  function setLibraryURL(readingId) { const url = new URL(location.href); url.searchParams.delete('session'); url.searchParams.set('view','library'); if(readingId)url.searchParams.set('reading',readingId);else url.searchParams.delete('reading'); history.replaceState(null,'',url); }
  function detach() { disposeNarration(); clearTimeout(captureTimer); captureTimer = null; captureChecking = false; generation++; captureToken++; capture.cancel('interrupted'); state.client?.deactivate(); state.client = null; state.libraryClient?.deactivate(); state.libraryClient = null; state.historyClient?.deactivate(); state.historyClient = null; state.historyFocus = null; state.libraryCatalogue = []; state.libraryLessons = []; state.librarySessions = []; state.librarySentenceDraft = null; state.libraryInterestDraft = null; state.libraryInterestsDirty = false; state.giftClient?.deactivate(); state.giftClient = null; state.gameClient?.deactivate(); state.gameClient = null; state.homeGame = null; }
  function failure(error) {
    state.error = true; state.message = MESSAGES[error.code || error.message] || 'Mình chưa lưu được bước này. Con kiểm tra tiến độ rồi thử lại nhé.';
    if (['parent', 'recovery'].includes(state.screen)) {
      const familyMessages = { connection_lost: 'Chưa kết nối được máy chủ. Anh chị có thể gửi lại đúng yêu cầu đang giữ.', request_timeout: 'Máy chủ chưa trả lời kịp. Anh chị kiểm tra dữ liệu đã lưu hoặc gửi lại đúng yêu cầu nhé.', rate_limited: 'Đã có nhiều lần thử. Anh chị đợi một phút rồi thử lại nhé.' };
      state.message = familyMessages[error.code] || state.message;
    }
    if (state.screen === 'gifts' && ['connection_lost','request_timeout'].includes(error.code)) state.message = 'Chưa nhận được trả lời. Con đừng tạo lượt đổi mới; máy đang giữ đúng lượt cũ để gửi lại hoặc đối chiếu.';
    if (state.screen === 'gifts' && error.code === 'stale_revision') state.message = 'Mục tiêu đã đổi ở một lượt khác. Con xem dữ liệu mới rồi đối chiếu bản đang giữ nhé.';
    if (state.screen === 'game' && error.code === 'stale_revision') state.message = 'Đã có lựa chọn mới trên máy chủ. Con xem lựa chọn đã lưu trước khi bỏ bản cũ và chọn tiếp nhé.';
    if (state.screen === 'parent' && error.code === 'stale_revision') state.message = 'Hồ sơ đã thay đổi ở một lượt khác. Anh chị cập nhật hồ sơ rồi sửa trên phiên bản mới nhé.';
    if (['library','free-reading'].includes(state.screen) && error.code === 'stale_revision') state.message = 'Thư viện hoặc chỗ đọc đã đổi ở một lượt khác. Con xem dữ liệu đã lưu trước khi bỏ lượt cũ và thử lại nhé.';
    if (['library','free-reading'].includes(state.screen) && error.code === 'invalid_request') state.message = 'Một lựa chọn thư viện chưa hợp lệ. Con kiểm tra lại rồi thử nhé.';
    if (error.code === 'content_unavailable') { detach(); state.screen = 'learning'; state.lessons = []; state.sessions = []; setSessionURL(null); }
    if (error.code === 'parent_required') { state.family = null; state.familyAudit = []; state.screen = 'parent'; if (state.access) state.access.role = 'child'; familyClient.forgetPayload(); }
    if (error.code === 'child_access_disabled') { detach(); if (state.access) state.access = { ...state.access, active_child_id: null }; state.screen = 'learning'; }
    if (['unauthorized', 'access_expired', 'wrong_child', 'csrf_failed'].includes(error.code)) { detach(); state.access = null; state.family = null; state.familyAudit = []; familyClient.forgetPayload(); api.csrf = null; }
  }
  async function run(work) {
    if (state.busy) return;
    state.busy = true; state.message = ''; state.error = false; paint();
    try { await work(); } catch (e) { failure(e); }
    finally { state.loading = false; state.busy = false; paint(); }
  }
  async function authenticate(access) {
    detach(); state.access = access; api.csrf = access.csrf;
    access.children.forEach(c => knownChildren.add(c.id));
    scope = access.active_child_id ? await cache.activateChild(access.active_child_id) : null;
    clearTimeout(parentTimer);
    if (access.role === 'parent' && access.parent_expires_at) parentTimer = setTimeout(() => {
      state.access = state.access ? { ...state.access, role: 'child', parent_expires_at: null } : null;
      state.family = null; state.familyAudit = []; familyClient.forgetPayload();
      if (state.screen === 'parent') { state.message = MESSAGES.parent_required; paint(); }
    }, Math.max(0, Date.parse(access.parent_expires_at) - Date.now()));
  }
  async function loadHome() {
    detach(); state.screen = 'learning'; state.family = null; state.familyAudit = []; familyClient.forgetPayload(); setSessionURL(null);
    const token = generation;
    const verifyAccess = async () => {
      const live = await api.request('me');
      if (live.csrf !== api.csrf) throw new ApiError('csrf_failed');
      if (live.active_child_id !== state.access?.active_child_id && live.active_child_id !== null) throw new ApiError('wrong_child');
      state.access = live;
    };
    await verifyAccess();
    if (!state.access.active_child_id) { state.lessons = []; state.sessions = []; scope = null; paint(true); return; }
    const result = await api.request('lessons');
    let homeGame = null;
    try { homeGame = (await api.request('game')).game; }
    catch (error) { if (['unauthorized','access_expired','wrong_child','csrf_failed','child_access_disabled'].includes(error.code)) throw error; }
    await verifyAccess();
    if (!state.access.active_child_id) { state.lessons = []; state.sessions = []; scope = null; paint(true); return; }
    if (result.sessions.some(s => s.child_id !== state.access.active_child_id)) throw new ApiError('wrong_child');
    if (generation !== token) return;
    if (homeGame) state.homeGame = acceptGame(homeGame,state.access.active_child_id);
    state.lessons = result.lessons; state.sessions = result.sessions; paint(true);
  }
  async function attach(view, wallet) {
    detach(); state.screen = 'learning';
    const client = new SessionClient({ api, cache, scope, view, onChange: () => { if (state.client === client) paint(); } });
    state.client = client;
    await client.accept(view, wallet);
    // Another tab may have a newer acknowledged cache. Fetch its full view before allowing actions.
    if (client.row.acknowledged.revision > client.view.session.revision) await client.refresh();
    setSessionURL(view.session.session_id); paint(true);
  }
  async function openSession(id) { const r = await api.request('session?session_id=' + id); await attach(r.view, r.wallet); }
  async function afterLogin() {
    state.screen = 'learning';
    if (!state.access.active_child_id) { await loadHome(); return; }
    const params = new URL(location.href).searchParams, readingId = params.get('reading');
    if (params.get('view') === 'gifts') { await loadGifts(); return; }
    if (params.get('view') === 'game') { await loadGame(); return; }
    if (params.get('view') === 'library') {
      await loadLibrary();
      if (readingId && validId(readingId)) {
        try { await openFreeSaved(readingId); } catch (error) { if(error.code !== 'reading_not_found') throw error; state.message=MESSAGES.reading_not_found; }
      }
      return;
    }
    const id = new URL(location.href).searchParams.get('session');
    if (id && validId(id)) {
      try { await openSession(id); return; }
      catch (e) { if (!['wrong_child', 'session_missing'].includes(e.code)) throw e; state.message = 'Bài trong đường dẫn thuộc hồ sơ khác hoặc chưa có. Con chọn bài trong hành trình của mình nhé.'; }
    }
    await loadHome();
  }
  async function startLesson(lessonId) {
    if (state.libraryClient?.pending || state.libraryClient?.storageInvalid) throw new ApiError('library_pending');
    const key = 'r2l-start:' + state.access.active_child_id + ':' + lessonId;
    let requestId;
    try { requestId = sessionStorage.getItem(key); } catch { /* In-memory request remains reusable until navigation. */ }
    requestId ||= state.startRequest?.key === key ? state.startRequest.id : 'start-' + crypto.randomUUID();
    state.startRequest = { key, id: requestId };
    try { sessionStorage.setItem(key, requestId); } catch { /* Optional start recovery, never fabricated progress. */ }
    const result = await api.request('start', { request_id: requestId, child_id: state.access.active_child_id, lesson_id: lessonId });
    await attach(result.view, result.wallet);
    state.startRequest = null; try { sessionStorage.removeItem(key); } catch { /* No private state retained here. */ }
  }
  async function submit(event, payload) { const key = activityKey(); await state.client.submit(event, payload); if (!state.client.row.pending) drafts.delete(key); }
  async function verifyCapture() {
    const client = state.client, id = client?.view?.session?.session_id;
    if (!id || !client.active) throw new ApiError('content_unavailable');
    const current = await api.request('session?session_id=' + id);
    if (state.client !== client || !client.active || current.view?.session?.session_id !== id || current.view.session.child_id !== state.access?.active_child_id) throw new ApiError('wrong_child');
    const live = await api.request('me');
    if (live.csrf !== api.csrf) throw new ApiError('csrf_failed');
    if (!live.active_child_id || live.active_child_id !== state.access?.active_child_id) throw new ApiError('wrong_child');
    if (live.children.find(c => c.id === live.active_child_id)?.recording_allowed !== true) throw new ApiError('recording_disabled');
    if (state.client !== client || !client.active) throw new ApiError('wrong_child');
    state.access = live; return live;
  }
  async function watchCapture(token) {
    if (token !== captureToken || !['recording', 'requesting'].includes(capture.state)) return;
    try { await verifyCapture(); } catch (e) {
      if (token !== captureToken) return;
      if (e.code === 'content_unavailable') { failure(e); paint(true); return; }
      capture.cancel('permission_changed'); captureMessage = MESSAGES[e.code] || 'Đã dừng micro. Anh chị kiểm tra lại quyền truy cập nhé.'; updateCapture(); return;
    }
    if (token === captureToken && capture.state === 'recording') captureTimer = setTimeout(() => { void watchCapture(token); }, 2000);
  }
  async function loadFamily() {
    detach(); state.screen = 'parent'; setSessionURL(null);
    state.family = null; state.familyAudit = [];
    const live = await api.request('me');
    if (live.csrf !== api.csrf) throw new ApiError('csrf_failed');
    state.access = live;
    if (live.role !== 'parent') return;
    const result = await api.request('parent/family'), audit = await api.request('parent/audit'), final = await api.request('me');
    if (final.csrf !== api.csrf) throw new ApiError('csrf_failed');
    if (final.role !== 'parent') throw new ApiError('parent_required');
    state.access = final; state.family = result; state.familyAudit = audit.events;
    result.children.forEach(c => knownChildren.add(c.id)); paint(true);
  }
  async function familyResult(route, result) {
    if (route === 'recover') {
      detach(); familyClient.forgetPayload(); state.access = null; state.family = null; state.familyAudit = [];
      api.csrf = null; state.screen = 'learning'; setSessionURL(null);
      state.message = 'Đã đổi bộ mã mẫu. Anh chị dùng mã gia đình mới để vào lại; bài đã lưu vẫn còn.';
    } else {
      try { await loadFamily(); } catch (e) { if (['unauthorized', 'access_expired', 'csrf_failed', 'parent_required'].includes(e.code)) throw e; throw new ApiError('family_saved_refresh_needed'); }
      state.message = result.replayed ? 'Đã đối chiếu đúng lượt gửi trước. Thay đổi đã được lưu một lần.' : 'Đã lưu thay đổi của gia đình mẫu.';
    }
  }
  async function mutateFamily(route, scopeId, data) {
    const result = await familyClient.submit(route, scopeId, data); await familyResult(route, result);
  }
  async function loadGifts() {
    detach(); state.screen = 'gifts'; state.giftHistoryCount = 10;
    const url = new URL(location.href); url.searchParams.delete('session'); url.searchParams.delete('reading'); url.searchParams.set('view','gifts'); history.replaceState(null,'',url);
    const client = new GiftClient({api,storage:browserStorage,access:state.access}); state.giftClient = client; await client.refresh(); paint(true);
  }
  function giftSaved(result) { state.message = result.receipt.goal ? 'Đã lưu mục tiêu. Kim cương của con vẫn được giữ nguyên.' : result.replayed ? 'Đã đối chiếu đúng lượt cũ. Con xem số dư và trạng thái hiện tại ở dưới nhé.' : 'Đã ghi nhận lượt đổi mẫu. Con xem số dư và lịch sử mới nhất nhé.'; }
  async function loadGame() {
    detach(); state.screen='game'; state.family=null; state.familyAudit=[]; familyClient.forgetPayload();
    const url=new URL(location.href);url.searchParams.delete('session');url.searchParams.delete('reading');url.searchParams.set('view','game');history.replaceState(null,'',url);
    const live=await api.request('me');if(live.csrf!==api.csrf)throw new ApiError('csrf_failed');
    if(live.active_child_id!==null&&live.active_child_id!==state.access?.active_child_id)throw new ApiError('wrong_child');state.access=live;
    if(!live.active_child_id){await loadHome();return;}
    const client=new GameClient({api,storage:browserStorage,childId:live.active_child_id});state.gameClient=client;
    await client.refresh();if(state.gameClient!==client)return;state.gameSlot='body';state.gamePage=0;paint(true);
  }
  async function gameSaved(result) {
    state.message=result.replayed?'Đã đối chiếu đúng lượt cũ. Lựa chọn chỉ được lưu một lần.':'Đã lưu bạn đồng hành. Không trừ kim cương.';
    try{await state.gameClient.refresh();}catch(error){if(['unauthorized','access_expired','wrong_child','csrf_failed','child_access_disabled','game_scope_expired'].includes(error.code))throw error;throw new ApiError('game_saved_refresh_needed');}
  }
  async function loadHistoryPage(kind, reset = false) {
    const client = state.historyClient, index = reset ? 0 : client.page(kind).entries.length;
    try {
      const page = await (reset ? client.refresh(kind) : client.more(kind));
      if (state.historyClient !== client) return;
      const entry = page.entries[index], key = kind === 'practice' ? 'session_id' : 'reading_id';
      state.historyFocus = entry ? 'history-' + kind + '-' + entry[key] : kind === 'practice' ? 'library-practice-heading' : 'free-history-heading';
    } catch (error) { if (state.historyClient === client) state.historyFocus = 'history-page-' + kind; throw error; }
  }
  function libraryQuery() {
    const f=state.libraryFilters, query=new URLSearchParams();
    if(f.level)query.set('level',f.level);if(f.interest)query.set('interest',f.interest);if(f.favorites)query.set('favorites','1');
    return 'library'+(query.size?'?'+query.toString():'');
  }
  async function filterLibrary() {
    const client=state.libraryClient, result=await client.refresh(libraryQuery());
    if(state.libraryClient!==client)return;
    state.libraryServerLessons=result.lessons;applyPublisherFilters();state.librarySessions=result.sessions;
  }
  async function loadLibrary() {
    detach();state.screen='library';state.family=null;state.familyAudit=[];familyClient.forgetPayload();setLibraryURL(null);
    const live=await api.request('me');if(live.csrf!==api.csrf)throw new ApiError('csrf_failed');
    if(live.active_child_id!==null&&live.active_child_id!==state.access?.active_child_id)throw new ApiError('wrong_child');state.access=live;
    if(!live.active_child_id){await loadHome();return;}
    const client=new LibraryClient({api,storage:browserStorage,childId:live.active_child_id});state.libraryClient=client;
    const historyClient=new HistoryClient({api,childId:live.active_child_id});state.historyClient=historyClient;
    const result=await client.refresh();if(state.libraryClient!==client)return;
    state.libraryCatalogue=result.lessons;state.librarySessions=result.sessions;state.libraryInterestDraft=[...result.library.preferences.interest_ids];state.libraryInterestsDirty=false;state.libraryHistoryCount=10;
    if(state.libraryFilterChild!==live.active_child_id){state.libraryFilterChild=live.active_child_id;state.libraryFilters={level:result.lessons.some(l=>l.source?.collection_level)?'':live.children.find(c=>c.id===live.active_child_id).level,interest:'',favorites:false};state.publisherFilters={query:'',collection:'',month:''};}
    await Promise.all([historyClient.refresh('practice'),historyClient.refresh('reading')]);
    if(state.historyClient!==historyClient)return;
    await filterLibrary();paint(true);
  }
  async function openFreeSaved(readingId) {
    const client=state.libraryClient, view=await client.openSaved(readingId);if(state.libraryClient!==client)return;
    state.librarySentenceDraft=view.reading.sentence_id;state.screen='free-reading';setLibraryURL(view.reading.reading_id);paint(true);
  }
  async function libraryResult(result) {
    if(result.current_view){state.screen='free-reading';state.librarySentenceDraft=result.current_view.reading.sentence_id;setLibraryURL(result.current_view.reading.reading_id);}
    state.libraryInterestDraft=[...result.library.preferences.interest_ids];state.libraryInterestsDirty=false;
    try{await filterLibrary();}catch(error){if(['unauthorized','access_expired','wrong_child','csrf_failed','child_access_disabled','library_scope_expired'].includes(error.code))throw error;throw new ApiError('library_saved_refresh_needed');}
    state.message=result.replayed?'Đã đối chiếu đúng lượt trước. Thay đổi được lưu một lần.':'Đã lưu thay đổi của con.';
  }
  async function mutateLibrary(route,data){await libraryResult(await state.libraryClient.submit(route,data));}
  root.addEventListener('submit', ev => {
    const form = ev.target; if (!(form instanceof HTMLFormElement)) return; ev.preventDefault();
    const data = new FormData(form);
    if(form.id==='library-interests-form'){
      const ids=data.getAll('interest');if(ids.length>3){failure(new ApiError('too_many_interests'));paint();return;}
      const change={expected_revision:state.libraryClient.library.preferences.revision,interest_ids:ids};void run(()=>mutateLibrary('library/interests',change));return;
    }
    if(form.id==='free-position-form'){
      const reading=state.libraryClient.view.reading,change={reading_id:reading.reading_id,expected_revision:reading.revision,sentence_id:String(data.get('sentence_id')),marked_finished:ev.submitter?.value==='finish'};
      void run(()=>mutateLibrary('library/position',change));return;
    }
    if (form.id === 'login-form') { const code = String(data.get('access_code') || '').trim(); void run(async () => { await authenticate(await api.request('login', { access_code: code })); await afterLogin(); }); return; }
    if (form.id === 'parent-entry-form') {
      const secret = String(data.get('parent_secret') || '');
      void run(async () => { await authenticate(await api.request('parent/enter', { parent_secret: secret })); await loadFamily(); }); return;
    }
    if (form.id === 'family-create-form') {
      const name = String(data.get('display_name') || '').trim(), id = state.family.family_id;
      void run(() => mutateFamily('parent/create-child', id, { display_name: name })); return;
    }
    if (form.dataset.familyUpdate) {
      const child = state.family.children.find(c => c.id === form.dataset.familyUpdate);
      const change = { child_id: child.id, expected_revision: child.revision, display_name: String(data.get('display_name') || '').trim(),
        archived: data.has('archived'), learning_enabled: data.has('learning_enabled'), recording_allowed: data.has('recording_allowed') };
      void run(() => mutateFamily('parent/update-child', child.id, change)); return;
    }
    if (form.id === 'recovery-form') {
      const change = Object.fromEntries(['family_id','recovery_code','new_access_code','new_parent_secret','new_recovery_code'].map(k => [k, String(data.get(k) || '')]));
      void run(() => mutateFamily('recover', change.family_id, change)); return;
    }
    const name = form.dataset.event; if (!name || !state.client || state.client.row?.pending) return;
    if(oralLesson()){const payload=publisherPayload({event:name,itemId:form.dataset.item,data,responseKind:ev.submitter?.value,captureStatus});void run(()=>submit(name,payload));return;}
    let text = String(data.get('text') || '').trim();
    if (name === 'retell') {
      const selected = [0, 1, 2].map(i => data.get('picture' + i) || '');
      if (selected.some(Boolean)) {
        try { text = pictureOrderText(retellPictures(state.client.view.lesson), selected) + (text ? '\nTyped response: ' + text : ''); }
        catch (error) { failure(error); paint(); return; }
        if ([...text].length > 1500) { state.error = true; state.message = 'Con rút ngắn lời kể một chút để giữ được cả thứ tự tranh nhé.'; paint(); return; }
      }
    }
    const speech = { text, capture_status: captureStatus, support_used: name === 'shadow_complete' ? ['reference_script'] : [] };
    let payload;
    if (name === 'prediction') payload = { text };
    else if (name === 'answer') payload = { ...speech, item_id: form.dataset.item, choice_index: Number(data.get('choice')), evidence_sentence_ids: data.getAll('evidence') };
    else if (['repair_answer', 'followup_answer'].includes(name)) payload = { ...speech, item_id: form.dataset.item, choice_index: Number(data.get('choice')) };
    else if (name === 'minny_turn') payload = { ...speech, turn_id: form.dataset.item };
    else payload = speech;
    void run(() => submit(name, payload));
  });
  root.addEventListener('input', ev => {
    if(ev.target.id==='narration-seek'){narration?.seek(Number(ev.target.value));return;}
    if(ev.target.id==='library-title-search'){state.publisherFilters.query=ev.target.value;applyPublisherFilters();paint();return;}
    const note = ev.target.form?.querySelector('.profile-save-state'); if (note) note.textContent = 'Chưa lưu thay đổi.';
  });
  root.addEventListener('change', ev => {
    if(['library-collection-filter','library-month-filter'].includes(ev.target.id)){state.publisherFilters[ev.target.id==='library-collection-filter'?'collection':'month']=ev.target.value;applyPublisherFilters();paint();return;}
    if(ev.target.id==='game-slot'){state.gameSlot=ev.target.value;state.gamePage=0;paint();return;}
    if(ev.target.form?.id==='library-interests-form'){
      state.libraryInterestDraft=[...ev.target.form.querySelectorAll('input[name=interest]:checked')].map(el=>el.value);state.libraryInterestsDirty=true;
      root.querySelector('#library-interest-note').textContent=state.libraryInterestDraft.length>3?'Con chọn tối đa 3 điều nhé.':'Chưa lưu lựa chọn.';
    }
    if(ev.target.id==='free-position'){
      state.librarySentenceDraft=ev.target.value;root.querySelector('#free-position-note').textContent=ev.target.value===state.libraryClient.view.reading.sentence_id?'Con có thể quay lại đúng chỗ đã lưu.':'Chưa lưu chỗ mới.';
    }
    if(['library-level-filter','library-interest-filter','library-favorites-filter'].includes(ev.target.id)){
      const key={'library-level-filter':'level','library-interest-filter':'interest','library-favorites-filter':'favorites'}[ev.target.id];state.libraryFilters[key]=key==='favorites'?ev.target.checked:ev.target.value;
      void run(filterLibrary);
    }
    if (ev.target.hasAttribute('data-picture-order') && state.message === MESSAGES.incomplete_picture_order) {
      state.message = ''; state.error = false; paint();
    }
    if (ev.target.id === 'recovery-family') { state.recoveryFamily = ev.target.value; paint(); }
    if (ev.target.name === 'learning_enabled' && !ev.target.checked) ev.target.form.elements.recording_allowed.checked = false;
    if (ev.target.id === 'child-select') { const id = ev.target.value; void run(async () => { await authenticate(await api.request('child', { child_id: id })); await loadHome(); }); }
    if (ev.target.id === 'level-filter') { state.filter = ev.target.value; paint(); root.querySelector('#level-filter')?.focus(); }
  });
  root.addEventListener('click', ev => {
    const button = ev.target.closest('button[data-action]'); if (!button || button.disabled) return;
    const action = button.dataset.action;
    if(action==='narration-pause'){narration?.pause();return;}
    if(action.startsWith('narration-')){void run(()=>playNarration(action,button.dataset.segment));return;}
    if (action === 'reload') { location.reload(); return; }
    if(action==='game-preview-retry'){paintGamePreviews();return;}
    if(action==='library-jump'){const id=state.libraryClient?.view?.reading.sentence_id;root.querySelector('#free-sentence-'+CSS.escape(id))?.scrollIntoView({block:'center',behavior:'smooth'});return;}
    if (action === 'microphone') {
      narration?.pause();
      const token = ++captureToken;
      captureChecking = true; captureMessage = 'Đang kiểm tra quyền dùng micro…'; updateCapture();
      void (async () => {
        try {
          await verifyCapture(); if (token !== captureToken) return;
          const result = await capture.start(); if (token !== captureToken) return;
          if (!result.ok) { captureStatus = 'missing'; captureMessage = result.reason === 'microphone_denied' ? 'Micro chưa được cho phép. Con vẫn có thể gõ ý và tiếp tục; phần đọc đã lưu vẫn còn.' : 'Chưa mở được micro. Con có thể gõ ý và tiếp tục.'; }
          else { captureMessage = 'Đang thử ghi · Tối đa 60 giây · Không gửi âm thanh.'; captureTimer = setTimeout(() => { void watchCapture(token); }, 2000); }
        } catch (e) { if (token === captureToken) { if (e.code === 'content_unavailable') { failure(e); paint(true); return; } capture.cancel('permission_changed'); captureMessage = MESSAGES[e.code] || 'Chưa mở được micro. Con vẫn có thể gõ ý của mình.'; } }
        finally { if (token === captureToken) { captureChecking = false; updateCapture(); } }
      })(); return;
    }
    if (action === 'stop-microphone') { capture.finish(); updateCapture(); return; }
    void run(async () => {
      if(action==='gift-open'){await loadGifts();return;}
      if(action==='gift-set-goal'){giftSaved(await state.giftClient.chooseGoal(button.dataset.gift));return;}
      if(action==='gift-clear-goal'){giftSaved(await state.giftClient.chooseGoal(null));return;}
      if(action==='gift-prepare'){await state.giftClient.preparePurchase(button.dataset.gift);return;}
      if(action==='gift-confirm'){giftSaved(await state.giftClient.confirmPurchase());return;}
      if(action==='gift-cancel'){state.giftClient.cancelPurchase();return;}
      if(action==='gift-retry'){giftSaved(await state.giftClient.retry());return;}
      if(action==='gift-check'){await state.giftClient.refresh();state.message='Đã tải số dư và lịch sử mới nhất. Lượt đang giữ vẫn còn để đối chiếu.';return;}
      if(action==='gift-discard'){await state.giftClient.discardRejected();state.message='Đã bỏ bản đang giữ sau khi đối chiếu. Lịch sử trên máy chủ vẫn còn.';return;}
      if(action==='gift-more-history'){state.giftHistoryCount+=10;return;}
      if(action==='game-open'){await loadGame();return;}
      if(action==='game-color'){state.gameClient.choose('color',button.dataset.color);return;}
      if(action==='game-part'){state.gameClient.choose(state.gameSlot,button.dataset.part);return;}
      if(action==='game-page'){state.gamePage=Math.max(0,state.gamePage+Number(button.dataset.direction));return;}
      if(action==='game-save'){await gameSaved(await state.gameClient.save());return;}
      if(action==='game-retry'){await gameSaved(await state.gameClient.retry());return;}
      if(action==='game-check'){await state.gameClient.refresh();state.message='Đã tải lựa chọn trên máy chủ. Bản đang giữ của con vẫn còn để đối chiếu.';return;}
      if(action==='game-discard'){await state.gameClient.discard();state.message='Đã trở về lựa chọn trên máy chủ. Những lần lưu trước vẫn còn.';return;}
      if(action==='library-open'){await loadLibrary();return;}
      if(action==='library-read'){await mutateLibrary('library/open',{lesson_id:button.dataset.lesson});return;}
      if(action==='library-resume'){await openFreeSaved(button.dataset.reading);return;}
      if(action==='library-favorite'){const l=state.libraryClient.library;await mutateLibrary('library/favorite',{expected_revision:l.preferences.revision,lesson_id:button.dataset.lesson,favorite:!l.favorites.some(f=>f.lesson_id===button.dataset.lesson)});return;}
      if(action==='library-retry'){await libraryResult(await state.libraryClient.retry());return;}
      if(action==='library-check'){
        await filterLibrary();if(state.screen==='free-reading'&&state.libraryClient.view)await openFreeSaved(state.libraryClient.view.reading.reading_id);
        state.message='Đã tải dữ liệu mới nhất. Lượt đang giữ vẫn còn để con gửi lại hoặc bỏ sau khi đối chiếu.';return;
      }
      if(action==='library-discard'){await state.libraryClient.discard();await filterLibrary();state.message='Đã bỏ lượt đang giữ trên máy này. Thay đổi đã lưu trên máy chủ vẫn còn.';return;}
      if(action==='library-reset-filters'){state.publisherFilters={query:'',collection:'',month:''};state.libraryFilters={level:'',interest:'',favorites:false};await filterLibrary();return;}
      if(action==='history-more'){await loadHistoryPage(button.dataset.kind);return;}
      if(action==='history-reload'){await loadHistoryPage(button.dataset.kind,true);return;}
      if(action==='library-more-history'){state.libraryHistoryCount+=10;return;}
      if (action === 'parent-open') { await loadFamily(); return; }
      if (action === 'parent-exit') { familyClient.forgetPayload(); await authenticate(await api.request('parent/exit', {})); await loadHome(); return; }
      if (action === 'recovery-open') { detach(); familyClient.forgetPayload(); state.screen = 'recovery'; return; }
      if (action === 'recovery-back') { familyClient.forgetPayload(); state.screen = 'learning'; if (state.access) await loadHome(); return; }
      if (action === 'family-check') { if (state.screen !== 'recovery') await loadFamily(); else state.message = 'Anh chị về màn hình truy cập và thử mã mới trước. Nếu cần gửi lại, dùng đúng bộ mã đã nhập ban đầu.'; return; }
      if (action === 'family-retry') { const route = familyClient.pending?.route; const result = await familyClient.retry(); await familyResult(route, result); return; }
      if (action === 'family-clear') {
        if (button.dataset.route !== 'recover') await loadFamily();
        familyClient.clear(button.dataset.route, button.dataset.scope);
        state.message = 'Đã bỏ mã lượt đang giữ. Thay đổi đã lưu trên máy chủ vẫn còn; anh chị kiểm tra trước khi tạo lượt mới.'; return;
      }
      if (action === 'home') { await loadHome(); return; }
      if (action === 'start') { await startLesson(button.dataset.lesson); return; }
      if (action === 'open-session') { await openSession(button.dataset.session); return; }
      if (action === 'logout') {
        await api.request('logout', {});
        const children = [...knownChildren]; detach(); familyClient.forgetPayload(); clearTimeout(parentTimer);
        state.access = null; state.family = null; state.familyAudit = []; state.screen = 'learning'; knownChildren.clear(); api.csrf = null; state.startRequest = null; drafts.clear(); setSessionURL(null);
        for (const id of children) { LibraryClient.clearOnLogout(browserStorage,id); GameClient.clearOnLogout(browserStorage,id); const childScope = await cache.activateChild(id); await cache.signOut(childScope); } return;
      }
      if (!state.client) return;
      if (action === 'retry') { await state.client.retry(); return; }
      if (action === 'refresh-session') { await state.client.refresh(); return; }
      if (action === 'discard') { await state.client.discard(); state.message = 'Đã bỏ lượt chưa gửi. Tiến độ được xác nhận vẫn còn.'; return; }
      if (action === 'hint' || action === 'frame') { await submit('support', { item_id: button.dataset.item, kind: action === 'hint' ? 'revealing_hint' : 'frame' }); return; }
      const events = { pause: 'pause', resume: 'resume', 'input-complete': 'input_complete', 'begin-repair': 'begin_repair', 'skip-repair': 'skip_repair', 'save-understand': 'save_understand', 'begin-use': 'begin_use', 'skip-followup': 'skip_followup', complete: 'complete' };
      if (events[action]) { if(action==='pause'||action==='input-complete')narration?.pause(); await submit(events[action], action === 'input-complete' ? { order: ['read'] } : {}); }
    });
  });
  window.addEventListener('pagehide', () => { detach(); clearTimeout(parentTimer); familyClient.forgetPayload(); state.family = null; state.familyAudit = []; cache?.close(); });
  // Back/forward cache restores a document whose local handles were closed on pagehide.
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  paint();
  try {
    cache = await openPendingStore();
    const access = await api.request('me'); await authenticate(access); await afterLogin();
  } catch (e) { if (e.code !== 'unauthorized') failure(e); if (!cache) state.fatal = true; }
  finally { state.loading = false; paint(); }
}
