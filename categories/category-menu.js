// ============================================================
// categories/category-menu.js — The Categories table's right-click menu
// Draws the items category-tree.js decides on. A blocked item stays
// in the menu, greyed, with its reason on hover and on a click.
// ============================================================

let _categoryMenu = null;

/**
 * Open the menu at a point, replacing any menu already open.
 * @param {{x: number, y: number, items: Array<Object>, onPick: function(string): void,
 *   returnFocusTo: HTMLElement|null}} options items as category-tree.js returns them.
 */
function openCategoryMenu({ x, y, items, onPick, returnFocusTo }) {
  closeCategoryMenu(false);

  const menu = document.createElement('div');
  menu.className = 'cat-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Category actions');

  items.forEach((item, index) => {
    if (item.divider) {
      const divider = document.createElement('div');
      divider.className = 'cat-menu-divider';
      divider.setAttribute('role', 'separator');
      menu.appendChild(divider);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cat-menu-item';
    button.setAttribute('role', 'menuitem');
    button.tabIndex = -1;
    button.dataset.menuId = item.id;
    button.textContent = item.label;
    if (!item.enabled) {
      // aria-disabled, not disabled, so the item still takes hover and focus
      // and can give its reason.
      button.setAttribute('aria-disabled', 'true');
      button.title = item.reason;
      const reason = document.createElement('span');
      reason.className = 'visually-hidden';
      reason.id = `cat-menu-reason-${index}`;
      reason.textContent = item.reason;
      button.appendChild(reason);
      button.setAttribute('aria-describedby', reason.id);
      button.dataset.reason = item.reason;
    }
    menu.appendChild(button);
  });

  document.body.appendChild(menu);
  _placeCategoryMenu(menu, x, y);

  const state = { menu, onPick, returnFocusTo, listeners: [] };
  _categoryMenu = state;

  const listen = (target, type, handler, capture) => {
    target.addEventListener(type, handler, capture);
    state.listeners.push(() => target.removeEventListener(type, handler, capture));
  };

  listen(menu, 'click', event => {
    const button = event.target.closest('.cat-menu-item');
    if (!button) return;
    if (button.getAttribute('aria-disabled') === 'true') {
      showStatus(button.dataset.reason, 'warning');
      return;
    }
    const id = button.dataset.menuId;
    closeCategoryMenu(false);
    onPick(id);
  });
  listen(menu, 'contextmenu', event => event.preventDefault());
  listen(menu, 'keydown', _onCategoryMenuKeydown);
  listen(document, 'mousedown', event => {
    if (!menu.contains(event.target)) closeCategoryMenu(false);
  }, true);
  listen(window, 'blur', () => closeCategoryMenu(false));
  listen(window, 'resize', () => closeCategoryMenu(false));
  listen(document, 'scroll', () => closeCategoryMenu(false), true);

  const firstEnabled = menu.querySelector('.cat-menu-item:not([aria-disabled="true"])') || menu.querySelector('.cat-menu-item');
  if (firstEnabled) firstEnabled.focus({ preventScroll: true });
}

/** Keep the menu inside the window, flipping above or left of the point when it would overflow. */
function _placeCategoryMenu(menu, x, y) {
  const margin = 8;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = x;
  let top = y;
  if (left + width + margin > window.innerWidth) left = Math.max(margin, x - width);
  if (top + height + margin > window.innerHeight) top = Math.max(margin, y - height);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function _onCategoryMenuKeydown(event) {
  const menu = _categoryMenu && _categoryMenu.menu;
  if (!menu) return;
  const items = Array.from(menu.querySelectorAll('.cat-menu-item'));
  const index = items.indexOf(document.activeElement);

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeCategoryMenu(true);
    return;
  }
  if (event.key === 'Tab') {
    event.preventDefault();
    closeCategoryMenu(true);
    return;
  }
  let next = null;
  if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
  if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
  if (event.key === 'Home') next = items[0];
  if (event.key === 'End') next = items[items.length - 1];
  if (next) {
    event.preventDefault();
    next.focus();
  }
}

/**
 * Close the open menu, if any.
 * @param {boolean} restoreFocus Put focus back on the row the menu came from.
 */
function closeCategoryMenu(restoreFocus) {
  const state = _categoryMenu;
  if (!state) return;
  _categoryMenu = null;
  state.listeners.forEach(remove => remove());
  state.menu.remove();
  if (restoreFocus && state.returnFocusTo && document.contains(state.returnFocusTo)) {
    state.returnFocusTo.focus({ preventScroll: true });
  }
}
