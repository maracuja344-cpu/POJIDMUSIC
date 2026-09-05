import { getCurrentAuthState, subscribeToAuthState } from "./auth.js";
import { supabase } from "./supabase/client.js";

const PANEL_ID = "pojidmusic-admin-panel";
const REQUEST_MODAL_ID = "pojidmusic-artist-request";
let initialized = false;
let activeProfileRole = null;
let activeUserId = null;
let unreadCount = 0;

function ensureStyles() {
    if (document.querySelector('link[data-admin-panel-style]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "admin-panel.css";
    link.dataset.adminPanelStyle = "true";
    document.head.append(link);
}

function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(value) {
    if (!value) return "";
    try {
        return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
    } catch { return ""; }
}

function getProfileLabel(profile, fallback = "Пользователь") {
    return profile?.display_name?.trim() || profile?.username?.trim() || fallback;
}

function getAdminMenuButton() {
    let button = document.querySelector("[data-admin-panel-open]");
    if (button) return button;
    const menu = document.querySelector(".profile-menu");
    const separator = menu?.querySelector(".profile-menu-separator");
    if (!menu || !separator) return null;
    button = document.createElement("button");
    button.className = "profile-menu-item admin-panel-menu-item";
    button.type = "button";
    button.role = "menuitem";
    button.hidden = true;
    button.dataset.adminPanelOpen = "";
    button.innerHTML = '<span>Admin</span><span class="admin-menu-badge" data-admin-menu-badge hidden></span>';
    menu.insertBefore(button, separator);
    return button;
}

function ensureRequestButton() {
    const actions = document.querySelector("[data-account-actions]");
    if (!actions) return null;
    let button = actions.querySelector("[data-request-artist-role]");
    if (!button) {
        button = document.createElement("button");
        button.className = "profile-action-button artist-role-request-button";
        button.type = "button";
        button.dataset.requestArtistRole = "";
        button.textContent = "Стать артистом";
        actions.append(button);
    }
    return button;
}

function ensurePanel() {
    let root = document.getElementById(PANEL_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = PANEL_ID;
    root.className = "admin-panel-overlay";
    root.hidden = true;
    root.innerHTML = `<div class="admin-panel-shell" role="dialog" aria-modal="true" aria-labelledby="admin-panel-title"><header class="admin-panel-header"><div><p class="admin-panel-kicker">POJIDMUSIC CONTROL</p><h2 id="admin-panel-title">Admin</h2></div><button class="admin-panel-close" type="button" data-admin-panel-close aria-label="Закрыть">×</button></header><div class="admin-panel-summary"><div><strong data-admin-pending-requests>0</strong><span>заявок</span></div><div><strong data-admin-pending-tracks>0</strong><span>треков</span></div><div><strong data-admin-unread>0</strong><span>новых</span></div></div><p class="admin-panel-status" data-admin-status role="status" aria-live="polite"></p><section class="admin-panel-section"><div class="admin-section-heading"><h3>Заявки на артиста</h3><span data-admin-request-count></span></div><div class="admin-list" data-admin-requests></div></section><section class="admin-panel-section"><div class="admin-section-heading"><h3>Треки на проверке</h3><span data-admin-track-count></span></div><div class="admin-list" data-admin-tracks></div></section><section class="admin-panel-section admin-events-section"><div class="admin-section-heading"><h3>Последние события</h3><button type="button" class="admin-mark-read" data-admin-mark-read>Прочитано</button></div><div class="admin-event-list" data-admin-events></div></section></div>`;
    document.body.append(root);
    return root;
}

function ensureRequestModal() {
    let root = document.getElementById(REQUEST_MODAL_ID);
    if (root) return root;
    root = document.createElement("div");
    root.id = REQUEST_MODAL_ID;
    root.className = "artist-request-overlay";
    root.hidden = true;
    root.innerHTML = `<div class="artist-request-dialog" role="dialog" aria-modal="true" aria-labelledby="artist-request-title"><div class="artist-request-heading"><div><p class="admin-panel-kicker">ROLE REQUEST</p><h2 id="artist-request-title">Стать артистом</h2></div><button type="button" data-artist-request-close aria-label="Закрыть">×</button></div><p>Оставь коротко, кто ты и под каким именем хочешь публиковаться. Заявка попадёт напрямую в админку.</p><form data-artist-request-form><textarea name="message" maxlength="1000" rows="4" placeholder="Например: это Тимошка, хочу заливать свои демки"></textarea><p class="artist-request-status" data-artist-request-status role="status" aria-live="polite"></p><button class="artist-request-submit" type="submit">Отправить заявку</button></form></div>`;
    document.body.append(root);
    return root;
}

function setBodyOverlay(open) {
    document.documentElement.classList.toggle("admin-overlay-open", open);
    document.body.classList.toggle("admin-overlay-open", open);
}
function closePanel() { const panel = document.getElementById(PANEL_ID); if (!panel || panel.hidden) return; panel.hidden = true; setBodyOverlay(false); }
function closeRequestModal() { const modal = document.getElementById(REQUEST_MODAL_ID); if (!modal || modal.hidden) return; modal.hidden = true; setBodyOverlay(false); }

async function fetchAdminData() {
    const [requestsResult, tracksResult, eventsResult] = await Promise.all([
        supabase.from("artist_role_requests").select("id,user_id,message,status,created_at,profiles:user_id(id,display_name,username,avatar_url)").eq("status", "pending").order("created_at", { ascending: true }),
        supabase.from("tracks").select("id,owner_id,title,artist_name,status,created_at,profiles:owner_id(id,display_name,username,avatar_url)").eq("status", "pending").order("created_at", { ascending: true }),
        supabase.from("admin_notifications").select("id,kind,actor_user_id,artist_request_id,track_id,created_at,read_at").order("created_at", { ascending: false }).limit(30)
    ]);
    const firstError = requestsResult.error || tracksResult.error || eventsResult.error;
    if (firstError) throw firstError;
    return { requests: requestsResult.data || [], tracks: tracksResult.data || [], events: eventsResult.data || [] };
}

function renderRequests(root, rows) {
    const container = root.querySelector("[data-admin-requests]");
    root.querySelector("[data-admin-pending-requests]").textContent = rows.length;
    root.querySelector("[data-admin-request-count]").textContent = rows.length ? `${rows.length} pending` : "";
    if (!rows.length) { container.innerHTML = '<p class="admin-empty">Новых заявок нет.</p>'; return; }
    container.innerHTML = rows.map((row) => { const profile = row.profiles || {}; const name = escapeHtml(getProfileLabel(profile)); const username = profile.username ? `@${escapeHtml(profile.username)}` : "без username"; const message = row.message ? `<p class="admin-card-message">${escapeHtml(row.message)}</p>` : ""; return `<article class="admin-card" data-request-id="${row.id}"><div class="admin-card-copy"><strong>${name}</strong><span>${username} · ${formatDate(row.created_at)}</span>${message}</div><div class="admin-card-actions"><button type="button" data-request-action="reject">Отклонить</button><button class="is-primary" type="button" data-request-action="approve">Дать Artist</button></div></article>`; }).join("");
}

function renderTracks(root, rows) {
    const container = root.querySelector("[data-admin-tracks]");
    root.querySelector("[data-admin-pending-tracks]").textContent = rows.length;
    root.querySelector("[data-admin-track-count]").textContent = rows.length ? `${rows.length} pending` : "";
    if (!rows.length) { container.innerHTML = '<p class="admin-empty">Треков на проверке нет.</p>'; return; }
    container.innerHTML = rows.map((row) => { const owner = getProfileLabel(row.profiles, row.artist_name || "Артист"); return `<article class="admin-card" data-track-id="${row.id}"><div class="admin-card-copy"><strong>${escapeHtml(row.title)}</strong><span>${escapeHtml(row.artist_name || owner)} · загрузил ${escapeHtml(owner)} · ${formatDate(row.created_at)}</span></div><div class="admin-card-actions"><button type="button" data-track-action="reject">Отклонить</button><button class="is-primary" type="button" data-track-action="publish">Опубликовать</button></div></article>`; }).join("");
}

function updateMenuBadge() { const badge = document.querySelector("[data-admin-menu-badge]"); if (!badge) return; badge.hidden = unreadCount < 1; badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount); }
function renderEvents(root, rows) {
    const container = root.querySelector("[data-admin-events]"); unreadCount = rows.filter((row) => !row.read_at).length; root.querySelector("[data-admin-unread]").textContent = unreadCount; updateMenuBadge();
    if (!rows.length) { container.innerHTML = '<p class="admin-empty">Событий пока нет.</p>'; return; }
    container.innerHTML = rows.map((row) => { const label = row.kind === "track_upload" ? "Новый трек загружен" : "Новая заявка на Artist"; return `<div class="admin-event ${row.read_at ? "" : "is-unread"}"><span>${escapeHtml(label)}</span><time>${formatDate(row.created_at)}</time></div>`; }).join("");
}

async function refreshAdminPanel({ silent = false } = {}) {
    if (activeProfileRole !== "admin") return;
    const root = ensurePanel(); const status = root.querySelector("[data-admin-status]"); if (!silent) status.textContent = "Обновляю…";
    try { const data = await fetchAdminData(); renderRequests(root, data.requests); renderTracks(root, data.tracks); renderEvents(root, data.events); status.textContent = ""; }
    catch (error) { console.error("Не удалось загрузить админ-панель.", error); status.textContent = "Не удалось загрузить данные. Попробуй ещё раз."; }
}
async function openPanel() { if (activeProfileRole !== "admin") return; const panel = ensurePanel(); panel.hidden = false; setBodyOverlay(true); await refreshAdminPanel(); }

async function submitArtistRequest(form) {
    const status = form.querySelector("[data-artist-request-status]"); const submit = form.querySelector("button[type='submit']"); const message = String(new FormData(form).get("message") || "").trim(); submit.disabled = true; status.textContent = "Отправляю…";
    try { const { error } = await supabase.rpc("submit_artist_role_request", { request_message: message || null }); if (error) throw error; status.textContent = "Заявка отправлена. Она появилась в админке."; form.reset(); const requestButton = document.querySelector("[data-request-artist-role]"); if (requestButton) { requestButton.textContent = "Заявка отправлена"; requestButton.disabled = true; } window.setTimeout(closeRequestModal, 900); }
    catch (error) { console.error("Не удалось отправить заявку на роль артиста.", error); status.textContent = "Не получилось отправить заявку. Попробуй ещё раз."; }
    finally { submit.disabled = false; }
}

async function reviewRequest(card, approve) {
    const requestId = card?.dataset.requestId; if (!requestId) return; card.dataset.pending = "true";
    try { const { error } = await supabase.rpc("review_artist_role_request", { target_request_id: requestId, approve, note: null }); if (error) throw error; await refreshAdminPanel({ silent: true }); }
    catch (error) { console.error("Не удалось обработать заявку.", error); card.dataset.pending = "false"; }
}
async function moderateTrack(card, action) {
    const trackId = card?.dataset.trackId; if (!trackId) return; card.dataset.pending = "true"; const nextStatus = action === "publish" ? "published" : "rejected";
    try { const { error } = await supabase.from("tracks").update({ status: nextStatus }).eq("id", trackId).eq("status", "pending"); if (error) throw error; window.dispatchEvent(new CustomEvent("managedtrackchange")); await refreshAdminPanel({ silent: true }); }
    catch (error) { console.error("Не удалось изменить статус трека.", error); card.dataset.pending = "false"; }
}
async function markEventsRead() {
    if (!activeUserId || activeProfileRole !== "admin") return; const { error } = await supabase.from("admin_notifications").update({ read_at: new Date().toISOString() }).is("read_at", null); if (error) { console.error("Не удалось отметить уведомления прочитанными.", error); return; } await refreshAdminPanel({ silent: true });
}

function bindEvents() {
    document.addEventListener("click", (event) => { const target = event.target instanceof Element ? event.target : null; if (!target) return;
        if (target.closest("[data-admin-panel-open]")) { void openPanel(); return; }
        if (target.closest("[data-admin-panel-close]")) { closePanel(); return; }
        if (target.closest("[data-request-artist-role]")) { const modal = ensureRequestModal(); modal.hidden = false; setBodyOverlay(true); modal.querySelector("textarea")?.focus(); return; }
        if (target.closest("[data-artist-request-close]")) { closeRequestModal(); return; }
        const requestAction = target.closest("[data-request-action]"); if (requestAction) { void reviewRequest(requestAction.closest("[data-request-id]"), requestAction.dataset.requestAction === "approve"); return; }
        const trackAction = target.closest("[data-track-action]"); if (trackAction) { void moderateTrack(trackAction.closest("[data-track-id]"), trackAction.dataset.trackAction); return; }
        if (target.closest("[data-admin-mark-read]")) void markEventsRead();
    });
    document.addEventListener("submit", (event) => { const form = event.target instanceof HTMLFormElement ? event.target : null; if (!form?.matches("[data-artist-request-form]")) return; event.preventDefault(); void submitArtistRequest(form); });
    document.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; closePanel(); closeRequestModal(); });
    window.addEventListener("managedtrackchange", () => { if (activeProfileRole === "admin") window.setTimeout(() => void refreshAdminPanel({ silent: true }), 150); });
}

async function syncListenerRequestState() {
    const button = ensureRequestButton(); if (!button) return; const isListener = activeProfileRole === "listener" && Boolean(activeUserId); button.hidden = !isListener; if (!isListener) return;
    const { data, error } = await supabase.from("artist_role_requests").select("id,status").eq("user_id", activeUserId).eq("status", "pending").limit(1); const pending = !error && Array.isArray(data) && data.length > 0; button.disabled = pending; button.textContent = pending ? "Заявка на Artist отправлена" : "Стать артистом";
}
function handleAuthState(authState) {
    activeProfileRole = authState?.profile?.role || null; activeUserId = authState?.user?.id || null; const adminButton = getAdminMenuButton(); if (adminButton) adminButton.hidden = activeProfileRole !== "admin";
    if (activeProfileRole !== "admin") { unreadCount = 0; updateMenuBadge(); closePanel(); } else { void refreshAdminPanel({ silent: true }); }
    void syncListenerRequestState();
}
export function initializeAdminPanel() { if (initialized) return; initialized = true; ensureStyles(); ensurePanel(); ensureRequestModal(); getAdminMenuButton(); ensureRequestButton(); bindEvents(); subscribeToAuthState(handleAuthState); handleAuthState(getCurrentAuthState()); }
initializeAdminPanel();
