/*
 * First-touch referrer capture (2026-09-23).
 *
 * The site used to record only UTM parameters, never document.referrer, so a
 * couple who arrived from Google search, Google Maps, The Knot, a venue site
 * or ChatGPT looked exactly like someone who typed the address in. This file
 * runs early on every public entry page and keeps two values in localStorage,
 * shared across pages on this origin:
 *
 *   fi_first_referrer  the external referrer on the visitor's FIRST tracked
 *                      pageview. Written once, never overwritten. Stays empty
 *                      when that first visit was direct.
 *   fi_referrer        the most recent external referrer (last touch).
 *
 * fi_ref_seen marks that the first pageview has been recorded, so a later
 * visit from Google cannot rewrite a first touch that was direct. A browser
 * that already carried fi_visitor_id or fi_landing_page before this file
 * shipped visited earlier than we can see, so it is marked 'legacy' and its
 * first touch is reported as unknown rather than as direct.
 *
 * It also seeds fi_landing_page when nothing has set it yet, so a couple who
 * lands on a venue page first still carries that page as their first landing
 * page into the inquiry (index.html and start.html only overwrite it when the
 * URL carries fresh UTM parameters).
 *
 * The inquiry forms and the /api/pageview beacon read these keys and send
 * them to the Worker as first_referrer and referrer.
 *
 * Per-couple tracked links (2026-11-16). A link we send a couple (DM, follow-up
 * email) can carry ?fi=<token>&fs=<source>. The token is 20 random letters
 * that only the Worker can map to the couple: no name, email or id. This file
 * runs first in the head, so it takes fi and fs off the address bar before
 * fi_landing_page, GA4 and the Meta pixel read the URL, keeps the token in
 * localStorage fi_link_token (fi-film-track.js sends it with film plays), and
 * posts once per such page load to api.flyiniris.com/api/link-open:
 * {t: token, v: fi_visitor_id, o: a random id for this page load, fs: source,
 * p: path}. That is the only data this
 * file sends. fi_visitor_id is created here the same way index.html does when
 * missing, after the first-touch check below so a new visitor is not marked
 * legacy.
 */
(function () {
  var fiToken = '', fiSource = '';
  try {
    var query = location.search.replace(/^\?/, '');
    if (query) {
      var kept = [];
      query.split('&').forEach(function (kv) {
        var key = kv.split('=')[0];
        var val = kv.slice(key.length + 1);
        var dec = val;
        try { dec = decodeURIComponent(val); } catch (e) { /* keep raw */ }
        if (key === 'fi') fiToken = dec;
        else if (key === 'fs') fiSource = dec;
        else if (kv) kept.push(kv);
      });
      if ((fiToken || fiSource) && window.history && history.replaceState) {
        history.replaceState(history.state, '', location.pathname + (kept.length ? '?' + kept.join('&') : '') + location.hash);
      }
    }
  } catch (e) { /* the page works the same without it */ }
  try {
    var ls = window.localStorage;
    var ref = document.referrer || '';
    var host = '';
    try { host = ref ? new URL(ref).hostname.toLowerCase() : ''; } catch (e) { host = ''; }
    var own = location.hostname.toLowerCase();
    var external = !!host && host !== own && !/(^|\.)flyiniris\.com$/.test(host);
    var clean = external ? ref.slice(0, 500) : '';
    if (!ls.getItem('fi_ref_seen')) {
      var legacy = !!(ls.getItem('fi_visitor_id') || ls.getItem('fi_landing_page'));
      ls.setItem('fi_ref_seen', legacy ? 'legacy' : String(Date.now()));
      if (clean && !legacy) ls.setItem('fi_first_referrer', clean);
    }
    if (clean) ls.setItem('fi_referrer', clean);
    if (!ls.getItem('fi_landing_page')) ls.setItem('fi_landing_page', location.href.split('#')[0]);
  } catch (e) { /* storage blocked: attribution degrades to UTM only */ }
  if (/^[a-z]{20}$/.test(fiToken) && !window.__fiLinkOpenSent) {
    window.__fiLinkOpenSent = true;
    var fiVisitor = '';
    try {
      localStorage.setItem('fi_link_token', fiToken);
      fiVisitor = localStorage.getItem('fi_visitor_id') || '';
      if (!fiVisitor) {
        fiVisitor = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        localStorage.setItem('fi_visitor_id', fiVisitor);
      }
    } catch (e) { /* storage blocked: the open is still recorded, without the browser */ }
    try {
      // o: a random id for this page load, so a replayed post counts once.
      var openId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      var linkBody = JSON.stringify({
        t: fiToken, v: fiVisitor, o: openId, p: location.pathname || '/',
        fs: fiSource.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32)
      });
      var linkUrl = 'https://api.flyiniris.com/api/link-open';
      var queued = false;
      try { queued = !!(navigator.sendBeacon && navigator.sendBeacon(linkUrl, linkBody)); } catch (e) { queued = false; }
      if (!queued && window.fetch) {
        fetch(linkUrl, { method: 'POST', body: linkBody, keepalive: true, mode: 'no-cors', credentials: 'omit', headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
      }
    } catch (e) { /* never break the page */ }
  }
  // Read helper for the page scripts. first_referrer is sent as an empty
  // string when the first visit was direct, so the Worker can tell "direct"
  // (key present, empty) apart from "unknown" (key absent: a legacy browser,
  // blocked storage, or an old cached page that never captured it).
  window.fiReferrerData = function () {
    var out = {};
    try {
      var seen = localStorage.getItem('fi_ref_seen');
      var first = localStorage.getItem('fi_first_referrer') || '';
      if (first || (seen && seen !== 'legacy')) out.first_referrer = first;
      var last = localStorage.getItem('fi_referrer') || '';
      if (last) out.referrer = last;
    } catch (e) { /* ignore */ }
    return out;
  };
})();
