/*
 * Film page tracker (2026-11-03, Studio Board #748).
 *
 * Cloudflare logs can only guess at watching, because a page loads video ahead
 * of what anyone actually sees. This keeps our own record of what happened on
 * a private film page. Loaded with defer on every films/<slug>/ page. It posts
 * one small JSON body per event to api.flyiniris.com/api/film-events with
 * navigator.sendBeacon (fetch keepalive fallback):
 *
 *   open       the page was opened
 *   play       a film started or resumed
 *   heartbeat  every 10 seconds of playing: position, seconds really watched
 *              since the last one, picture height and the quality menu setting
 *   pause      same fields, when a film pauses or the tab is hidden
 *   finished   a film reached its end (98 percent counts, since HLS streams
 *              do not always fire ended)
 *   download   a film download button was tapped
 *   photos     the photos section came into view, a photo opened, or a photo
 *              download was tapped
 *   share      any control marked data-fi-share (film pages have none today)
 *   tv         a Chromecast or AirPlay button was tapped, or a TV connected
 *
 * Identity is a random browser id in localStorage (fi-film-browser), separate
 * on purpose from the site's fi_visitor_id, so it never joins to an inquiry. No
 * names, no emails, nothing typed. The Worker stores no IP address.
 *
 * Our own devices: opening Studio sets the cookie fi_ours=1 on .flyiniris.com,
 * and ?fi_ours=1 on a film page link does the same for this browser (?fi_ours=0
 * undoes it). Remembered in localStorage (fi-film-ours). Studio filters those
 * browsers out, including anything they sent before they were marked.
 *
 * This must never slow or break playback. It listens from the outside, keeps
 * no timers, ignores every response, and every step is wrapped so it can never
 * throw into the page.
 */
(function () {
  try {
    if (window.__fiFilmTrack || !document.addEventListener) return;
    window.__fiFilmTrack = true;

    var match = location.pathname.match(/^\/films\/([a-z0-9-]+)\/?/);
    if (!match) return;
    var SLUG = match[1];
    var ENDPOINT = 'https://api.flyiniris.com/api/film-events';
    var BEAT_MS = 10000;
    var QUALITY_KEY = 'fi-quality:' + SLUG;

    function rid() {
      try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
      return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    function getItem(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function setItem(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private window */ } }

    var browserId = getItem('fi-film-browser');
    if (!browserId) { browserId = rid(); setItem('fi-film-browser', browserId); }
    var pageViewId = rid();

    var ours = getItem('fi-film-ours') === '1';
    try {
      if (/(?:^|;\s*)fi_ours=1(?:;|$)/.test(document.cookie)) ours = true;
      var flag = new URLSearchParams(location.search).get('fi_ours');
      if (flag === '1') ours = true;
      if (flag === '0') ours = false;
    } catch (e) { /* keep what we have */ }
    setItem('fi-film-ours', ours ? '1' : '0');

    function send(ev) {
      try {
        var body = JSON.stringify({ pv: pageViewId, b: browserId, slug: SLUG, ours: ours ? 1 : 0, events: [ev] });
        if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return;
        if (window.fetch) fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, mode: 'cors' }).catch(function () {});
      } catch (e) { /* tracking never surfaces */ }
    }

    // --- which film a <video> element is showing ---
    function filmOf(v) {
      var player = v.closest && v.closest('media-player');
      if (player && player.__fiVideoId) {
        // The player drops its title attribute once it starts; the pop-up heading has it.
        var heading = document.getElementById('modal-title');
        return { id: player.__fiVideoId, title: player.getAttribute('title') || (heading && heading.textContent) || null };
      }
      var hero = v.closest && v.closest('.hero-card');
      if (hero && hero.getAttribute('data-hero-id')) {
        var t = hero.querySelector('.hero-title');
        return { id: hero.getAttribute('data-hero-id'), title: t ? t.textContent : null };
      }
      return null;
    }
    // Short side of the picture, so a vertical 4K film still reads as 2160.
    function heightOf(v) {
      var w = v.videoWidth || 0, h = v.videoHeight || 0;
      return w && h ? Math.min(w, h) : null;
    }

    // --- watching ---
    var states = typeof WeakMap === 'function' ? new WeakMap() : null;
    var active = [];
    function stateOf(v) {
      if (!states || !v || v.tagName !== 'VIDEO') return null;
      var film = filmOf(v);
      if (!film) return null;
      var st = states.get(v);
      if (!st || st.id !== film.id) {
        st = { id: film.id, title: film.title, last: v.currentTime || 0, watched: 0, beatAt: Date.now(), playing: false, finished: false };
        states.set(v, st);
      }
      return st;
    }
    function report(v, st, name) {
      var ev = {
        e: name,
        id: st.id,
        title: st.title,
        pos: v.currentTime || 0,
        dur: isFinite(v.duration) ? v.duration : null,
        watched: st.watched,
        q: heightOf(v),
        m: getItem(QUALITY_KEY) || 'auto'
      };
      st.watched = 0;
      st.beatAt = Date.now();
      send(ev);
    }
    function finish(v, st) {
      if (st.finished) return;
      st.finished = true;
      report(v, st, 'finished');
    }
    function flush(v, st) {
      st.playing = false;
      var i = active.indexOf(v);
      if (i >= 0) active.splice(i, 1);
      if (st.watched > 0) report(v, st, 'pause');
    }

    document.addEventListener('play', function (e) {
      try {
        var v = e.target, st = stateOf(v);
        if (!st || st.playing) return;
        st.playing = true;
        st.last = v.currentTime || 0;
        st.beatAt = Date.now();
        if (isFinite(v.duration) && st.last < v.duration * 0.9) st.finished = false;
        if (active.indexOf(v) < 0) active.push(v);
        report(v, st, 'play');
      } catch (err) { /* never surfaces */ }
    }, true);

    document.addEventListener('timeupdate', function (e) {
      try {
        var v = e.target, st = stateOf(v);
        if (!st || !st.playing || v.paused) return;
        var t = v.currentTime || 0, step = t - st.last;
        st.last = t;
        if (step > 0 && step <= 3) st.watched += step; // anything bigger is a jump, not watching
        if (isFinite(v.duration) && v.duration > 5 && t >= v.duration * 0.98) finish(v, st);
        if (Date.now() - st.beatAt >= BEAT_MS) report(v, st, 'heartbeat');
      } catch (err) { /* never surfaces */ }
    }, true);

    document.addEventListener('pause', function (e) {
      try { var st = stateOf(e.target); if (st && st.playing) flush(e.target, st); } catch (err) { /* never surfaces */ }
    }, true);

    document.addEventListener('ended', function (e) {
      try {
        var v = e.target, st = stateOf(v);
        if (!st) return;
        if (st.playing) flush(v, st);
        finish(v, st);
      } catch (err) { /* never surfaces */ }
    }, true);

    // The tab going away is the last chance to send what is waiting.
    function flushAll() {
      try {
        for (var i = 0; i < active.length; i++) {
          var st = states && states.get(active[i]);
          if (st && st.watched > 0) report(active[i], st, 'pause');
        }
      } catch (err) { /* never surfaces */ }
    }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushAll(); });
    window.addEventListener('pagehide', flushAll);

    // --- TV ---
    var castHooked = false;
    function hookCast() {
      if (castHooked) return;
      try {
        var fw = window.cast && window.cast.framework;
        if (!fw) return;
        fw.CastContext.getInstance().addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, function (ev) {
          if (ev.sessionState === fw.SessionState.SESSION_STARTED) send({ e: 'tv', d: 'chromecast connected' });
        });
        castHooked = true;
      } catch (err) { /* never surfaces */ }
    }
    document.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', function (e) {
      try { if (e.target && e.target.webkitCurrentPlaybackTargetIsWireless) send({ e: 'tv', d: 'airplay connected' }); } catch (err) { /* never surfaces */ }
    }, true);

    // --- taps ---
    document.addEventListener('click', function (e) {
      try {
        var el = e.target && e.target.closest ? e.target : null;
        if (!el) return;
        var hit = el.closest('.download-item-btn');
        if (hit) {
          var row = hit.closest('.download-item');
          var name = row && row.querySelector('.download-item-title');
          send({ e: 'download', id: hit.getAttribute('data-video-id'), title: name ? name.textContent : null });
          return;
        }
        if (el.closest('.fi-ph-item')) { send({ e: 'photos', d: 'opened a photo' }); return; }
        if (el.closest('.fi-ph-lb-dl')) { send({ e: 'photos', d: 'downloaded a photo' }); return; }
        if (el.closest('.fi-ph-btn')) { send({ e: 'photos', d: 'downloaded a zip' }); return; }
        if (el.closest('[data-fi-share]')) { send({ e: 'share' }); return; }
        hit = el.closest('media-google-cast-button, media-airplay-button, .fi-tv-btn');
        if (hit) {
          hookCast();
          send({ e: 'tv', d: hit.tagName === 'MEDIA-AIRPLAY-BUTTON' ? 'airplay tapped' : hit.tagName === 'MEDIA-GOOGLE-CAST-BUTTON' ? 'chromecast tapped' : 'tv button tapped' });
          return;
        }
        // Download All Films has no class of its own, only its text.
        hit = el.closest('button');
        if (hit && /^download all films/i.test(hit.textContent || '')) send({ e: 'download', d: 'all films' });
      } catch (err) { /* never surfaces */ }
    }, true);

    // --- photos section seen ---
    try {
      var section = document.getElementById('photos');
      if (section && window.IntersectionObserver) {
        var seen = new IntersectionObserver(function (entries) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting && entries[i].intersectionRect.height > 0) {
              seen.disconnect();
              send({ e: 'photos', d: 'section seen' });
              return;
            }
          }
        });
        seen.observe(section);
      }
    } catch (err) { /* never surfaces */ }

    // --- the page open itself ---
    var names = document.querySelector('.hero-names');
    send({ e: 'open', title: names ? names.textContent : null });
  } catch (e) {
    /* tracking never surfaces */
  }
})();
