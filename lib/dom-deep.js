/**
 * querySelector across open shadow roots (closed shadows stay inaccessible).
 */
window.XDM = window.XDM || {};

/**
 * @param {string} sel
 * @returns {Element[]}
 */
window.XDM.deepQueryAll = function deepQueryAll(sel) {
  const found = [];

  /**
   * @param {HTMLElement | ShadowRoot} rootLike
   */
  function chunk(rootLike) {
    if (!rootLike?.querySelectorAll) return;
    try {
      rootLike.querySelectorAll(sel).forEach((n) => found.push(n));
    } catch {
      /* malformed selector fragments on isolated roots */
    }
  }

  /**
   * @param {HTMLElement | ShadowRoot} rootLike
   */
  function descend(rootLike) {
    chunk(rootLike);
    rootLike.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) descend(el.shadowRoot);
    });
  }

  descend(document.documentElement);
  return [...new Set(found)];
};
