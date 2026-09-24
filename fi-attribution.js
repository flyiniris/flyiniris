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
 * them to the Worker as first_referrer and referrer. Nothing here sends data
 * anywhere by itself.
 */
(function () {
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
