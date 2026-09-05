let lockedY = 0;
let locked = false;

function lockBackground() {
  if (locked) return;
  locked = true;
  lockedY = window.scrollY || window.pageYOffset || 0;
  document.documentElement.classList.add('album-upload-scroll-locked');
  Object.assign(document.body.style, {
    position: 'fixed',
    top: `-${lockedY}px`,
    left: '0',
    right: '0',
    width: '100%'
  });
}

function unlockBackground() {
  if (!locked) return;
  locked = false;
  document.documentElement.classList.remove('album-upload-scroll-locked');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  window.scrollTo(0, lockedY);
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
