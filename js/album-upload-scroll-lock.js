let locked = false;

function lockBackground() {
  if (locked) return;
  locked = true;
  document.documentElement.classList.add('album-upload-scroll-locked');
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
}

function unlockBackground() {
  if (!locked) return;
  locked = false;
  document.documentElement.classList.remove('album-upload-scroll-locked');
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
}

function syncLock() {
  const modal = document.querySelector('[data-album-upload-modal]');
  const open = Boolean(modal && !modal.hidden && document.body.classList.contains('album-upload-open'));
  if (open) lockBackground();
  else unlockBackground();
}

const observer = new MutationObserver(syncLock);
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['hidden', 'class']
});

window.addEventListener('touchmove', (event) => {
  if (!locked) return;
  const dialog = event.target.closest?.('.album-upload-dialog');
  if (!dialog) event.preventDefault();
}, { passive: false, capture: true });

syncLock();
