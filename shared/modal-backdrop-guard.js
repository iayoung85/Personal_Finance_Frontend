// ============================================================
// modal-backdrop-guard.js — Shared backdrop-click guard
// ============================================================
// A drag that starts inside a modal and ends on its backdrop
// (e.g. selecting text in a field) fires a click on the backdrop,
// which every "click outside to close" handler treats as a close.
// This guard swallows such a click before it reaches the page's
// handler, so a backdrop closes a modal only when the press and
// the release both land on it. Modals with no backdrop handler
// are unaffected.
// ============================================================

const MODAL_BACKDROP_SELECTOR = '.modal-overlay, .assign-modal-overlay';

let _modalBackdropPressTarget = null;

// Capture phase on the document runs before any handler on the
// backdrop itself, including inline onclick attributes.
document.addEventListener('pointerdown', (event) => {
  _modalBackdropPressTarget = event.target;
}, true);

document.addEventListener('click', (event) => {
  const clickTarget = event.target;
  const isBackdrop = clickTarget instanceof Element && clickTarget.matches(MODAL_BACKDROP_SELECTOR);
  if (isBackdrop && _modalBackdropPressTarget !== clickTarget) {
    event.stopPropagation();
  }
  _modalBackdropPressTarget = null;
}, true);
