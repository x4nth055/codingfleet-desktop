'use strict';
// The page's CSP has no 'unsafe-inline' for styles, so a <style> tag whose text
// is set by a script is ignored. xterm.js styles each terminal that way. Here
// that text goes into a constructed stylesheet instead, which the CSP allows,
// and the sheet goes away with its tag. The tag itself never enters the page,
// where the CSP would report it even empty.
(function () {
  if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) return;
  const sheets = new WeakMap();
  const texts = new WeakMap();
  const proto = HTMLStyleElement.prototype;
  const remove = Element.prototype.remove;
  const append = Node.prototype.appendChild;

  Node.prototype.appendChild = function (node) {
    return node instanceof HTMLStyleElement ? node : append.call(this, node);
  };

  function setText(node, text) {
    const value = String(text ?? '');
    texts.set(node, value);
    let sheet = sheets.get(node);
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheets.set(node, sheet);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    sheet.replaceSync(value);
  }

  const accessor = {
    configurable: true,
    get() { return texts.get(this) ?? ''; },
    set(text) { setText(this, text); },
  };
  Object.defineProperty(proto, 'textContent', accessor);
  Object.defineProperty(proto, 'innerText', accessor);
  proto.remove = function () {
    const sheet = sheets.get(this);
    if (sheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      sheets.delete(this);
    }
    return remove.call(this);
  };
})();
