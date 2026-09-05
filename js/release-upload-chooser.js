import { openAlbumUpload } from './album-upload-entry.js?v=81';

let chooserOpen = false;
let bypassChooser = false;
let returnTrigger = null;

const TRIGGER_SELECTOR = [
    '[data-mobile-tab="upload"]',
    '.track-upload-open-button',
    '[data-profile-quick-upload]'
].join(',');

function getTelegramTopInset() {
    const webApp = window.Telegram?.WebApp;
    const candidates = [
        Number(webApp?.contentSafeAreaInset?.top),
        Number(webApp?.safeAreaInset?.top)
    ].filter((value) => Number.isFinite(value) && value >= 0);
    return candidates.length ? Math.max(...candidates) : 0;
}

function applyTelegramInset(modal) {
    const inTelegram = document.documentElement.dataset.telegramMiniApp === 'true' || Boolean(window.Telegram?.WebApp);
    const top = inTelegram ? Math.max(getTelegramTopInset(), 64) : getTelegramTopInset();
    modal.style.setProperty('--release-chooser-top', `${top}px`);
}

function removeLegacyModeSwitch() {
    document.querySelectorAll('[data-upload-mode-switch]').forEach((node) => node.remove());
}

function ensureChooser() {
    let modal = document.querySelector('[data-release-upload-chooser]');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.className = 'release-upload-chooser';
    modal.dataset.releaseUploadChooser = '';
    modal.hidden = true;
    modal.innerHTML = `
        <div class="release-upload-chooser-card" role="dialog" aria-modal="true" aria-labelledby="release-upload-chooser-title">
            <div class="release-upload-chooser-heading">
                <div>
                    <p>Новый релиз</p>
                    <h2 id="release-upload-chooser-title">Что загружаем?</h2>
                </div>
                <button type="button" data-close-release-chooser aria-label="Закрыть">×</button>
            </div>
            <div class="release-upload-chooser-options">
                <button type="button" class="release-upload-choice" data-release-choice="track">
                    <span class="release-upload-choice-icon" aria-hidden="true">♪</span>
                    <span class="release-upload-choice-copy"><strong>Трек</strong><small>Один трек, демо или сингл</small></span>
                    <span class="release-upload-choice-arrow" aria-hidden="true">›</span>
                </button>
                <button type="button" class="release-upload-choice" data-release-choice="album">
                    <span class="release-upload-choice-icon" aria-hidden="true">▦</span>
                    <span class="release-upload-choice-copy"><strong>Альбом</strong><small>Общая обложка и несколько треков</small></span>
                    <span class="release-upload-choice-arrow" aria-hidden="true">›</span>
                </button>
            </div>
        </div>`;
    document.body.append(modal);

    modal.querySelector('[data-close-release-chooser]').addEventListener('click', closeChooser);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeChooser();
    });
    modal.querySelector('[data-release-choice="track"]').addEventListener('click', openTrackFlow);
    modal.querySelector('[data-release-choice="album"]').addEventListener('click', openAlbumFlow);

    applyTelegramInset(modal);
    window.Telegram?.WebApp?.onEvent?.('safeAreaChanged', () => applyTelegramInset(modal));
    window.Telegram?.WebApp?.onEvent?.('contentSafeAreaChanged', () => applyTelegramInset(modal));
    return modal;
}

function openChooser(trigger) {
    const modal = ensureChooser();
    returnTrigger = trigger || document.querySelector('.track-upload-open-button') || null;
    chooserOpen = true;
    removeLegacyModeSwitch();
    applyTelegramInset(modal);
    modal.hidden = false;
    document.body.classList.add('release-upload-chooser-open');
    requestAnimationFrame(() => {
        modal.querySelector('[data-release-choice="track"]')?.focus({ preventScroll: true });
    });
}

export function openReleaseUploadChooser(trigger = null) {
    openChooser(trigger);
}

function closeChooser({ restoreFocus = true } = {}) {
    const modal = document.querySelector('[data-release-upload-chooser]');
    if (modal) modal.hidden = true;
    chooserOpen = false;
    document.body.classList.remove('release-upload-chooser-open');
    if (restoreFocus) returnTrigger?.focus?.({ preventScroll: true });
}

async function openTrackFlow() {
    closeChooser({ restoreFocus: false });
    bypassChooser = true;
    try {
        await import('./track-upload-wizard-entry.js');
        const uploadModule = await import('./track-upload.js');
        uploadModule.initializeTrackUpload();
        const actualUploadButton =
            document.querySelector('.profile-menu .track-upload-open-button') ||
            document.querySelector('.track-upload-open-button');
        if (!actualUploadButton) throw new Error('Не найдена кнопка загрузки трека.');
        actualUploadButton.click();
        removeLegacyModeSwitch();
    } catch (error) {
        console.error('Не удалось открыть загрузку трека.', error);
    } finally {
        window.setTimeout(() => { bypassChooser = false; }, 0);
    }
}

function openAlbumFlow() {
    closeChooser({ restoreFocus: false });
    try {
        const trackModal = document.querySelector('.track-upload-modal');
        if (trackModal && !trackModal.hidden) {
            trackModal.hidden = true;
            document.body.classList.remove('track-upload-modal-open');
        }
        openAlbumUpload();
        const albumModal = document.querySelector('[data-album-upload-modal]');
        if (!albumModal) throw new Error('Окно загрузки альбома не создано.');
        albumModal.hidden = false;
        document.body.classList.add('album-upload-open');
    } catch (error) {
        console.error('Не удалось открыть загрузку альбома.', error);
        openChooser(returnTrigger);
    }
}

window.addEventListener('click', (event) => {
    if (bypassChooser || chooserOpen) return;
    const trigger = event.target.closest?.(TRIGGER_SELECTOR);
    if (!trigger) return;
    if (trigger.hidden || trigger.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openChooser(trigger);
}, true);

window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && chooserOpen) closeChooser();
});

new MutationObserver(removeLegacyModeSwitch).observe(document.documentElement, { childList: true, subtree: true });
removeLegacyModeSwitch();
