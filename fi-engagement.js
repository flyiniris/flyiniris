/*
 * Page engagement beacon (2026-10-07, Studio Board #228).
 *
 * Third-party tools forget (the Clarity API reaches back 3 days), so this
 * keeps our own permanent record of how each page view went. Loaded with
 * defer on the same public entry pages as fi-attribution.js. Per page view it
 * measures:
 *
 *   active_seconds  time the tab was visible AND the visitor touched, scrolled,
 *                   clicked, typed or moved the mouse in the last 30 seconds
 *                   (capped at one hour)
 *   max_scroll_pct  deepest point reached, 0 to 100 percent of the page
 *   cta_taps        taps on calls to action that lead to the inquiry form or
 *                   pricing. What counts (isCta below): any element with a
 *                   data-fi-cta attribute; links to #quiz, #inquiry,
 *                   #investment or #contact (same page or the home page);
 *                   links to /quiz/, /start or /calculator/; elements with
 *                   data-action="start" or "get-pricing"; and links or buttons
 *                   whose text reads Check Availability, Check my/your date,
 *                   Let's Talk, Get Pricing or Investment. Form submit buttons
 *                   (data-action="submit-...") are not taps; the inquiry itself
 *                   is recorded by the Worker.
 *   form_started    the visitor focused or typed in an inquiry form field
 *                   (any input, select or textarea inside a form, #quiz,
 *                   #quizApp, .quiz-form or [data-fi-form], or with the
 *                   quiz-form-input / form-input class). Field VALUES are never
 *                   read or sent.
 *
 * It posts {visitor_id, page_view_id, page_path, the four numbers, viewport}
 * to api.flyiniris.com/api/engagement with navigator.sendBeacon (fetch
 * keepalive fallback) whenever the tab is hidden or the page unloads, so one
 * page view can post more than once; the Worker keeps the maximum of each.
 * page_path is the path only (no query string: UTMs already ride on
 * /api/pageview). visitor_id is localStorage fi_visitor_id, created here the
 * same way index.html creates it when this page is the first to need it.
 * No cookies, no names, no emails, nothing typed. Every step is wrapped so it
 * can never throw into the page or the GA4 / Meta / Clarity / OpenAI tags.
 */
(function () {
  try {
    if (window.__fiEngagement || !window.addEventListener || !document.addEventListener) return;
    window.__fiEngagement = true;

    var ENDPOINT = 'https://api.flyiniris.com/api/engagement';
    var IDLE_MS = 30000;
    var MAX_ACTIVE_S = 3600;
    var CTA_HASHES = { '#quiz': 1, '#inquiry': 1, '#investment': 1, '#contact': 1 };
    var CTA_PATH_RE = /^\/(quiz|start|calculator)(\/|\.html)?$/i;
    var CTA_TEXT_RE = /check (my |your )?(date|availability)|let.?s talk|get (my |your )?pricing|^\s*investment\s*$/i;
    var FORM_SCOPE = 'form, #quiz, #quizApp, .quiz-form, [data-fi-form]';

    function rid() {
      try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
      return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }

    var pageViewId = rid();
    var activeMs = 0;
    var lastTick = Date.now();
    var lastInteract = Date.now(); // arriving counts as interest for the first 30 s
    var maxScroll = 0;
    var ctaTaps = 0;
    var formStarted = false;
    var lastSent = '';

    // Tracked by our own visibilitychange handler, not read from the document
    // at tick time: by the time 'hidden' fires the document already reports
    // hidden, which would drop the last visible stretch (a 3 second bounce
    // would read as 0).
    var visible = document.visibilityState !== 'hidden';
    function isVisible() { return visible; }

    function tick() {
      var now = Date.now();
      var dt = now - lastTick;
      lastTick = now;
      // Cap each step so a sleeping laptop or a frozen tab never adds a lump.
      if (dt > 0 && isVisible() && now - lastInteract <= IDLE_MS) activeMs += Math.min(dt, 5000);
    }

    function measureScroll() {
      try {
        var de = document.documentElement;
        var h = Math.max(de ? de.scrollHeight : 0, document.body ? document.body.scrollHeight : 0);
        if (!h) return;
        var y = window.pageYOffset || (de && de.scrollTop) || 0;
        var pct = Math.round(((y + (window.innerHeight || 0)) / h) * 100);
        if (pct > maxScroll) maxScroll = Math.min(100, Math.max(0, pct));
      } catch (e) { /* ignore */ }
    }

    function interacted() { tick(); lastInteract = Date.now(); }

    function isCta(el) {
      if (el.hasAttribute('data-fi-cta')) return true;
      var action = el.getAttribute('data-action') || '';
      if (/^submit/.test(action)) return false;
      if (action === 'start' || action === 'get-pricing') return true;
      if (el.tagName === 'A' && el.getAttribute('href')) {
        try {
          var u = new URL(el.href, location.href);
          var ours = u.hostname === location.hostname || /(^|\.)flyiniris\.com$/.test(u.hostname);
          if (ours) {
            if (u.hash && CTA_HASHES[u.hash.toLowerCase()] && (u.pathname === '/' || u.pathname === location.pathname)) return true;
            if (CTA_PATH_RE.test(u.pathname)) return true;
          }
        } catch (e) { /* bad href: fall through to the text check */ }
      }
      var text = (el.textContent || '').replace(/\s+/g, ' ').slice(0, 80);
      return CTA_TEXT_RE.test(text);
    }

    function onClick(e) {
      try {
        var t = e.target;
        var el = t && t.closest ? t.closest('a, button, [role="button"], [data-fi-cta]') : null;
        if (el && isCta(el)) ctaTaps = Math.min(ctaTaps + 1, 100);
      } catch (err) { /* ignore */ }
    }

    function onFormEvent(e) {
      try {
        if (formStarted) return;
        var el = e.target;
        if (!el || !el.tagName || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
        if (el.type === 'hidden') return;
        var cls = ' ' + (typeof el.className === 'string' ? el.className : '') + ' ';
        if ((el.closest && el.closest(FORM_SCOPE)) || cls.indexOf(' quiz-form-input ') !== -1 || cls.indexOf(' form-input ') !== -1) {
          formStarted = true;
        }
      } catch (err) { /* ignore */ }
    }

    function visitorId() {
      var v = '';
      try {
        v = localStorage.getItem('fi_visitor_id') || '';
        if (!v) {
          v = rid();
          localStorage.setItem('fi_visitor_id', v);
        }
      } catch (e) { /* storage blocked: send without it */ }
      return v;
    }

    function send() {
      try {
        tick();
        measureScroll();
        var data = {
          visitor_id: visitorId(),
          page_view_id: pageViewId,
          page_path: location.pathname || '/',
          active_seconds: Math.min(MAX_ACTIVE_S, Math.round(activeMs / 1000)),
          max_scroll_pct: maxScroll,
          cta_taps: ctaTaps,
          form_started: formStarted,
          viewport_w: window.innerWidth || 0,
          viewport_h: window.innerHeight || 0
        };
        var body = JSON.stringify(data);
        if (body === lastSent) return; // nothing new since the last post
        lastSent = body;
        var queued = false;
        // A plain string body goes out as text/plain: no CORS preflight.
        try { queued = !!(navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)); } catch (e) { queued = false; }
        if (!queued && window.fetch) {
          fetch(ENDPOINT, {
            method: 'POST', body: body, keepalive: true, mode: 'no-cors', credentials: 'omit',
            headers: { 'Content-Type': 'text/plain' }
          }).catch(function () {});
        }
      } catch (e) { /* never break the page */ }
    }

    var passive = { passive: true, capture: true };
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'].forEach(function (type) {
      document.addEventListener(type, interacted, passive);
    });
    window.addEventListener('scroll', function () { interacted(); measureScroll(); }, { passive: true });
    document.addEventListener('click', onClick, true);
    document.addEventListener('focusin', onFormEvent, true);
    document.addEventListener('input', onFormEvent, true);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { send(); visible = false; }
      else { visible = true; lastTick = Date.now(); lastInteract = Date.now(); }
    });
    window.addEventListener('pagehide', send);
    setInterval(tick, 5000);
    measureScroll();
  } catch (e) { /* never break the page */ }
})();
