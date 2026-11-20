// The branded gold dropdown (Sean approved on the upgrade page 2026-11-19/20).
// Copied from iris-automation src/lib/gold-dropdown.ts (GOLD_DROPDOWN_CSS and
// GOLD_DROPDOWN_JS, the canonical source); do not edit here, change it there
// and re-copy. Injects its CSS once, then window.fiEnhanceSelect(select) wraps
// a native <select> (which stays as the hidden value holder, so existing
// change listeners keep working).
(function () {
  if (!document.getElementById('fi-gold-dropdown-css')) {
    var st = document.createElement('style');
    st.id = 'fi-gold-dropdown-css';
    st.textContent = "\n.dd { position: relative; width: 100%; }\n.dd-native { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; border: 0 !important; margin: 0 !important; opacity: 0; pointer-events: none; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); left: 0; top: 0; }\n.dd-btn {\n  width: 100%; height: 48px; display: block; text-align: left; cursor: pointer;\n  background: var(--bg-elevated, #161616) url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23F5F0EB' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\") no-repeat right 16px center / 12px 8px;\n  border: 1px solid var(--border, rgba(245,245,245,0.12)); border-radius: 6px; padding: 0 44px 0 14px;\n  color: var(--text-primary, #F5F5F5); font-family: 'Outfit', sans-serif; font-size: 1rem; font-weight: 300;\n  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;\n}\n.dd-btn:focus { outline: none; }\n.dd-btn:focus-visible, .dd-btn[aria-expanded=\"true\"] { border-color: var(--accent, #FFBD1D); box-shadow: 0 0 0 2px rgba(255, 189, 29, 0.55); }\n.dd-btn:disabled { cursor: not-allowed; opacity: 0.6; }\n.dd-list {\n  position: absolute; z-index: 60; left: 0; right: 0; top: calc(100% + 6px); margin: 0; padding: 6px; list-style: none;\n  background: var(--bg-card, #111111); border: 1px solid var(--border-strong, rgba(245,245,245,0.2)); border-radius: 8px; box-shadow: 0 14px 34px rgba(0, 0, 0, 0.6);\n  max-height: 320px; overflow-y: auto; text-align: left;\n}\n.dd-list:focus { outline: none; }\n.dd-opt {\n  display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 46px; padding: 0 12px;\n  border-radius: 6px; color: var(--text-primary, #F5F5F5); font-size: 1rem; font-weight: 300; cursor: pointer; user-select: none;\n}\n.dd-opt.active { background: #FFBD1D; color: #0A0A0A; font-weight: 500; }\n.dd-opt[aria-disabled=\"true\"] { color: var(--text-muted, rgba(245,245,245,0.5)); cursor: not-allowed; }\n.dd-opt[aria-disabled=\"true\"].active { background: rgba(245, 245, 245, 0.06); color: var(--text-muted, rgba(245,245,245,0.5)); font-weight: 300; }\n.dd-opt .dd-right { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }\n.dd-opt .dd-check { width: 14px; height: 14px; color: #FFBD1D; }\n.dd-opt.active .dd-check { color: #0A0A0A; }\n@media (max-width: 700px) { .dd-opt { min-height: 50px; } }\n";
    (document.head || document.documentElement).appendChild(st);
  }
})();
(function () {
  if (window.fiEnhanceSelect) return;
  var CHECK_SVG = '<svg class="dd-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>';
  var ddSeq = 0, openDd = null;
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var proto = window.HTMLSelectElement && HTMLSelectElement.prototype;
  function enhanceSelect(native) {
    if (!native || !proto) return null;
    if (native._dd) { native._dd.sync(); return native._dd; }
    var n = ++ddSeq;
    var wrap = document.createElement('div'); wrap.className = 'dd';
    native.parentNode.insertBefore(wrap, native); wrap.appendChild(native);
    native.classList.add('dd-native'); native.tabIndex = -1; native.setAttribute('aria-hidden', 'true');
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dd-btn'; btn.id = 'dd-btn-' + n;
    btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
    var list = document.createElement('ul'); list.className = 'dd-list'; list.id = 'dd-list-' + n;
    list.setAttribute('role', 'listbox'); list.tabIndex = -1; list.hidden = true;
    wrap.appendChild(btn); wrap.appendChild(list);
    var lab = native.id ? document.querySelector('label[for="' + native.id + '"]') : null;
    var name = lab ? lab.textContent.trim() : (native.getAttribute('aria-label') || '');
    if (lab) { lab.htmlFor = btn.id; lab.id = lab.id || ('dd-lab-' + n); }
    var active = -1, typed = '', typedAt = 0;
    function opts() { return Array.prototype.slice.call(native.options); }
    function sync() {
      var o = native.options[native.selectedIndex];
      btn.textContent = o ? o.textContent : '';
      btn.disabled = !!native.disabled;
      btn.setAttribute('aria-label', name + ': ' + btn.textContent);
      list.setAttribute('aria-label', name);
      if (!list.hidden) render();
    }
    function render() {
      list.innerHTML = opts().map(function (o, i) {
        var sel = i === native.selectedIndex;
        return '<li role="option" id="' + list.id + '-' + i + '" data-i="' + i + '" aria-selected="' + (sel ? 'true' : 'false') + '"' +
          (o.disabled ? ' aria-disabled="true"' : '') + ' class="dd-opt' + (i === active ? ' active' : '') + '"><span>' + esc(o.textContent) +
          '</span><span class="dd-right">' + (sel ? CHECK_SVG : '') + '</span></li>';
      }).join('');
      if (active >= 0) list.setAttribute('aria-activedescendant', list.id + '-' + active); else list.removeAttribute('aria-activedescendant');
    }
    function setActive(i, scroll) {
      var os = opts(); if (!os.length) return;
      i = Math.max(0, Math.min(os.length - 1, i));
      active = i; render();
      if (scroll) { var el = list.children[i]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
    }
    function open() {
      if (native.disabled) return;
      if (openDd && openDd !== api) openDd.close(false);
      list.hidden = false; btn.setAttribute('aria-expanded', 'true'); openDd = api;
      setActive(native.selectedIndex >= 0 ? native.selectedIndex : 0, true);
      list.focus({ preventScroll: true });
    }
    function close(refocus) {
      if (list.hidden) return;
      list.hidden = true; btn.setAttribute('aria-expanded', 'false'); active = -1;
      if (openDd === api) openDd = null;
      if (refocus) btn.focus({ preventScroll: true });
    }
    function choose(i) {
      var o = native.options[i]; if (!o || o.disabled) return;
      var changed = native.selectedIndex !== i;
      native.selectedIndex = i; sync(); close(true);
      if (changed) native.dispatchEvent(new Event('change', { bubbles: true }));
    }
    btn.addEventListener('click', function () { if (list.hidden) open(); else close(true); });
    btn.addEventListener('keydown', function (e) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].indexOf(e.key) >= 0) { e.preventDefault(); open(); }
    });
    list.addEventListener('mousemove', function (e) {
      var li = e.target.closest && e.target.closest('.dd-opt'); if (!li) return;
      var i = Number(li.getAttribute('data-i')); if (i !== active) setActive(i, false);
    });
    list.addEventListener('click', function (e) {
      var li = e.target.closest && e.target.closest('.dd-opt'); if (li) choose(Number(li.getAttribute('data-i')));
    });
    list.addEventListener('keydown', function (e) {
      var os = opts();
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1, true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1, true); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0, true); }
      else if (e.key === 'End') { e.preventDefault(); setActive(os.length - 1, true); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') { close(false); }
      else if (e.key.length === 1 && /\S/.test(e.key)) {
        var now = Date.now(); typed = (now - typedAt > 700 ? '' : typed) + e.key.toLowerCase(); typedAt = now;
        for (var k = 1; k <= os.length; k++) {
          var j = (active + (typed.length > 1 ? 0 : k)) % os.length;
          if (os[j].textContent.toLowerCase().indexOf(typed) === 0) { setActive(j, true); break; }
        }
      }
    });
    // Programmatic changes re-sync the button: value / selectedIndex /
    // disabled set from code, and options rebuilt, renamed or disabled.
    ['value', 'selectedIndex', 'disabled'].forEach(function (prop) {
      var d = Object.getOwnPropertyDescriptor(proto, prop) || Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
      if (!d || !d.set) return;
      Object.defineProperty(native, prop, {
        configurable: true,
        get: function () { return d.get.call(native); },
        set: function (v) { d.set.call(native, v); sync(); },
      });
    });
    if (window.MutationObserver) {
      new MutationObserver(function () { sync(); }).observe(native, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected', 'label'] });
    }
    native.addEventListener('change', sync);
    var api = { sync: sync, close: close, wrap: wrap, btn: btn };
    native._dd = api; sync();
    return api;
  }
  document.addEventListener('pointerdown', function (e) {
    if (openDd && !openDd.wrap.contains(e.target)) openDd.close(false);
  });
  window.fiEnhanceSelect = enhanceSelect;
})();
