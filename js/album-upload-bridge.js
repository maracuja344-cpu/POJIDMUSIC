let openingAlbum = false;

function closeReleaseChooser() {
    const chooser = document.querySelector('[data-release-upload-chooser]');
    if (chooser) chooser.hidden = true;
    document.body.classList.remove('release-upload-chooser-open');
}

function closeTrackUploader() {
    const trackModal = document.querySelector('.track-upload-modal');
    if (!trackModal || trackModal.hidden) return;
    const close = trackModal.querySelector('[data-track-upload-close], .track-upload-close-button');
    if (close instanceof HTMLElement) close.click();
    else {
        trackModal.hidden = true;
        document.body.classList.remove('track-upload-modal-open');
    }
}

function forceAlbumModalVisible(modal) {
    if (!(modal instanceof HTMLElement)) return false;
    modal.hidden = false;
    modal.classList.add('is-open');
    modal.style.setProperty('display', 'flex', 'important');
    modal.style.setProperty('visibility', 'visible', 'important');
    modal.style.setProperty('opacity', '1', 'important');
    modal.style.setProperty('pointer-events', 'auto', 'important');
    modal.style.setProperty('z-index', '10000', 'important');
    document.body.classList.add('album-upload-open');
    return true;
}

async function openAlbumDirectly() {
    if (openingAlbum) return;
    openingAlbum = true;
    try {
        closeReleaseChooser();
        closeTrackUploader();
        const album = await import('./album-upload.js');
        album.openAlbumUpload?.();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const modal = document.querySelector('[data-album-upload-modal]');
        if (!forceAlbumModalVisible(modal)) {
            console.error('Album uploader modal was not created.');
            return;
        }
        modal.querySelector('[data-close-album-upload]')?.focus?.({ preventScroll: true });
    } catch (error) {
        console.error('Не удалось открыть загрузку альбома.', error);
    } finally {
        openingAlbum = false;
    }
}

window.addEventListener('click', (event) => {
    const target = event.target.closest?.('[data-release-choice="album"], [data-open-album-upload]');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void openAlbumDirectly();
}, true);

window.addEventListener('click', (event) => {
    const close = event.target.closest?.('[data-close-album-upload]');
    if (!close) return;
    const modal = document.querySelector('[data-album-upload-modal]');
    if (!modal) return;
    requestAnimationFrame(() => {
        if (!modal.hidden) return;
        modal.classList.remove('is-open');
        modal.style.removeProperty('display');
        modal.style.removeProperty('visibility');
        modal.style.removeProperty('opacity');
        modal.style.removeProperty('pointer-events');
        modal.style.removeProperty('z-index');
    });
});
