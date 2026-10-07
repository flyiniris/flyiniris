/* Flyin' Iris photo galleries (board #24).
 *
 * One script for every gallery surface:
 *   - couple film pages: <div data-fi-photos data-kind="couple"> inside the
 *     #photos section of films/<slug>/ (slug read from the path)
 *   - business and one-off galleries: gallery/index.html, kind "gallery"
 *
 * It reads the public listing from video.flyiniris.com/photos/<kind>/<slug>
 * and stays hidden when that 404s (no approved gallery yet). Full-size
 * downloads need the gallery password, a #dl=<key> signed link, or, on a
 * couple page, the token the film downloads already unlocked (one unlock
 * covers films and photos). Downloads are plain navigations to signed GET
 * URLs, so the browser's own download manager streams them to disk.
 *
 * Events on the root element: "fi-photos:ready" (detail = listing) and
 * "fi-photos:missing". Window event "fi-dl-token" (detail {token, from})
 * is shared with the couple page's film download script.
 */
(function () {
  'use strict';

  var API = 'https://video.flyiniris.com';
  // Mirrors ZIP_MAX_ENTRIES in delivery/workers/video-serve/src/index.js.
  var ZIP_MAX = 950;

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function plural(n, word) {
    return Number(n).toLocaleString('en-US') + ' ' + word + (n === 1 ? '' : 's');
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
    if (n >= 1e6) return Math.round(n / 1e6) + ' MB';
    return Math.max(1, Math.round(n / 1e3)) + ' KB';
  }
  function slugFromPath() {
    var m = location.pathname.match(/^\/(?:films|gallery)\/([a-z0-9-]{1,80})(?:\/|$)/);
    return m ? m[1] : '';
  }
  function linkKeyFromHash() {
    var m = (location.hash || '').match(/[#&]dl=([A-Za-z0-9_-]{20,})/);
    return m ? m[1] : null;
  }
  // Expiry from the JWT payload, with five minutes of slack.
  function tokenExpiry(token) {
    try {
      var p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      var exp = JSON.parse(atob(p)).exp;
      if (exp) return exp * 1000 - 300000;
    } catch (e) { /* fall through */ }
    return Date.now() + 23 * 3600000;
  }
  function navigateTo(url) {
    var a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  var ICONS = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>'
  };

  function Gallery(root) {
    this.root = root;
    this.wrap = root.closest('[data-fi-photos-wrap]') || root;
    this.kind = root.getAttribute('data-kind') === 'gallery' ? 'gallery' : 'couple';
    this.slug = root.getAttribute('data-slug') || slugFromPath();
    this.base = API + '/photos/' + this.kind + '/' + this.slug;
    this.token = null;
    this.tokenUntil = 0;
    this.filter = null; // null = every chapter
    this.visible = [];
    this.grids = [];
    this.lbIndex = -1;
    if (/^[a-z0-9-]{1,80}$/.test(this.slug)) this.load();
  }

  Gallery.prototype.load = function () {
    var self = this;
    fetch(this.base, { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('missing');
        return res.json();
      })
      .then(function (listing) {
        if (!listing || !listing.photos || !listing.photos.length) throw new Error('missing');
        self.listing = listing;
        self.render();
        self.wrap.hidden = false;
        self.relayout();
        self.root.dispatchEvent(new CustomEvent('fi-photos:ready', { detail: listing }));
        self.bootstrapAuth();
      })
      .catch(function () {
        self.root.dispatchEvent(new CustomEvent('fi-photos:missing'));
      });
  };

  // ---- chapters -------------------------------------------------------------

  Gallery.prototype.chapters = function () {
    var seen = {}, out = [], photos = this.listing.photos;
    for (var i = 0; i < photos.length; i++) {
      var c = photos[i].chapter || '';
      if (!seen.hasOwnProperty(c)) {
        seen[c] = { name: c, count: 0, bytes: 0 };
        out.push(seen[c]);
      }
      seen[c].count++;
      seen[c].bytes += Number(photos[i].bytes) || 0;
    }
    return out;
  };
  function chapterLabel(name) { return name || 'Photos'; }

  // ---- render ---------------------------------------------------------------

  Gallery.prototype.render = function () {
    var self = this, L = this.listing;
    this.root.innerHTML = '';
    this.root.classList.add('fi-ph');
    this.chapterList = this.chapters();

    var meta = plural(L.count || L.photos.length, 'photo');
    if (this.chapterList.length > 1) meta += ' in ' + plural(this.chapterList.length, 'chapter');
    this.root.appendChild(h('p', 'fi-ph-meta', meta));

    if (this.chapterList.length > 1) {
      var tabs = h('div', 'fi-ph-tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Chapters');
      var mk = function (label, value) {
        var b = h('button', 'fi-ph-tab', label);
        b.type = 'button';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', value === self.filter ? 'true' : 'false');
        b.addEventListener('click', function () {
          self.filter = value;
          var all = tabs.querySelectorAll('.fi-ph-tab');
          for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-selected', all[i] === b ? 'true' : 'false');
          self.renderGrids();
        });
        tabs.appendChild(b);
      };
      mk('All', null);
      this.chapterList.forEach(function (c) { mk(chapterLabel(c.name), c.name); });
      this.root.appendChild(tabs);
    }

    this.gridHost = h('div', 'fi-ph-grids');
    this.root.appendChild(this.gridHost);
    this.dl = h('div', 'fi-ph-dl');
    this.dl.id = 'fi-ph-dl-' + this.kind;
    this.root.appendChild(this.dl);
    this.renderGrids();
    this.renderDownloads();

    var lastW = 0, timer = null;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var w = self.gridHost.clientWidth;
        if (w !== lastW) { lastW = w; self.relayout(); }
      }, 120);
    });
  };

  Gallery.prototype.renderGrids = function () {
    var self = this, photos = this.listing.photos;
    this.gridHost.innerHTML = '';
    this.grids = [];
    this.visible = [];
    var groups = [];
    if (this.filter === null && this.chapterList.length > 1) {
      this.chapterList.forEach(function (c) {
        groups.push({ title: chapterLabel(c.name), photos: photos.filter(function (p) { return (p.chapter || '') === c.name; }) });
      });
    } else {
      var f = this.filter;
      groups.push({ title: null, photos: f === null ? photos : photos.filter(function (p) { return (p.chapter || '') === f; }) });
    }
    groups.forEach(function (g) {
      if (g.title) self.gridHost.appendChild(h('h3', 'fi-ph-chapter', g.title));
      var grid = h('div', 'fi-ph-grid');
      var items = [];
      g.photos.forEach(function (p) {
        var idx = self.visible.length;
        self.visible.push(p);
        var tw = p.thumb_w || p.w || 3, th = p.thumb_h || p.h || 2;
        var a = h('a', 'fi-ph-item');
        a.href = self.base + '/web/' + p.id + '.jpg';
        a.setAttribute('aria-label', 'Open photo ' + (idx + 1));
        var img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.width = tw;
        img.height = th;
        img.alt = '';
        img.addEventListener('load', function () { img.classList.add('fi-ph-in'); });
        img.src = self.base + '/thumb/' + p.id + '.jpg';
        a.appendChild(img);
        a.addEventListener('click', function (e) {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
          e.preventDefault();
          self.open(idx);
        });
        grid.appendChild(a);
        items.push({ a: a, ar: tw / th });
      });
      self.gridHost.appendChild(grid);
      self.grids.push({ el: grid, items: items });
    });
    this.relayout();
  };

  // Justified rows: fill each row to the container width at roughly the
  // target height. Sizes are set before images load, so no layout shift.
  Gallery.prototype.relayout = function () {
    var W = this.gridHost ? this.gridHost.clientWidth : 0;
    if (!W) return;
    var target = W < 600 ? 120 : (W < 1000 ? 180 : 230);
    var gap = 4;
    this.grids.forEach(function (g) {
      var row = [], sum = 0;
      var place = function (items, height, full) {
        var used = 0;
        for (var i = 0; i < items.length; i++) {
          var w = Math.floor(items[i].ar * height);
          if (full && i === items.length - 1) w = W - used - gap * (items.length - 1) - 0.5;
          items[i].a.style.width = w + 'px';
          items[i].a.style.height = Math.round(height) + 'px';
          used += w;
        }
      };
      for (var i = 0; i < g.items.length; i++) {
        row.push(g.items[i]);
        sum += g.items[i].ar;
        if (sum * target + gap * (row.length - 1) >= W) {
          place(row, (W - gap * (row.length - 1)) / sum, true);
          row = [];
          sum = 0;
        }
      }
      if (row.length) place(row, target, false);
    });
  };

  // ---- downloads and auth ---------------------------------------------------

  Gallery.prototype.hasToken = function () {
    return !!this.token && Date.now() < this.tokenUntil;
  };

  Gallery.prototype.setToken = function (token, broadcast) {
    if (typeof token !== 'string' || !token) return;
    this.token = token;
    this.tokenUntil = tokenExpiry(token);
    if (broadcast && this.kind === 'couple') {
      window.FI_DL_TOKEN = token;
      try { window.dispatchEvent(new CustomEvent('fi-dl-token', { detail: { token: token, from: 'photos' } })); } catch (e) { /* old browser */ }
    }
    this.renderDownloads();
  };

  Gallery.prototype.bootstrapAuth = function () {
    var self = this;
    if (this.kind === 'couple') {
      // The film download script on the same page shares its token.
      if (window.FI_DL_TOKEN) this.setToken(window.FI_DL_TOKEN, false);
      window.addEventListener('fi-dl-token', function (e) {
        if (e.detail && e.detail.from !== 'photos') self.setToken(e.detail.token, false);
      });
    }
    var key = linkKeyFromHash();
    // On a couple film page the film script already posts the #dl key and
    // shares the result, so only post it here when no film gate exists.
    var filmGate = this.kind === 'couple' && document.getElementById('download-gate');
    if (key && !this.hasToken() && !filmGate) this.authenticate({ link_key: key });
  };

  Gallery.prototype.authenticate = function (credentials) {
    var self = this;
    var viaLink = !!credentials.link_key;
    if (this.unlockBtn) { this.unlockBtn.disabled = true; this.unlockBtn.textContent = '...'; }
    fetch(this.base + '/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
      credentials: 'omit'
    })
      .then(function (res) {
        if (res.status === 429) throw new Error('rate');
        if (!res.ok) throw new Error('auth');
        return res.json();
      })
      .then(function (data) {
        if (!data || typeof data.token !== 'string' || !data.token) throw new Error('auth');
        self.setToken(data.token, true);
      })
      .catch(function (err) {
        self.renderDownloads(
          err && err.message === 'rate' ? 'Too many attempts. Try again in a few minutes.'
            : viaLink ? 'This download link has expired. Enter your password, or reply to our email for a fresh link.'
            : err && err.message === 'auth' ? 'Incorrect password. Please try again.'
            : 'Something went wrong. Please check your connection and try again.',
          !viaLink
        );
      });
  };

  Gallery.prototype.renderDownloads = function (message, focus, isHint) {
    var self = this, L = this.listing;
    if (!this.dl || !L) return;
    this.dl.innerHTML = '';
    this.unlockBtn = null;

    if (!this.hasToken()) {
      this.dl.appendChild(h('p', null, this.kind === 'couple'
        ? 'Enter your password to download the full-size photos. It is the same password as your films.'
        : 'Enter your password to download the full-size photos.'));
      var form = h('div', 'fi-ph-form');
      var input = h('input', 'fi-ph-input');
      input.type = 'password';
      input.placeholder = 'Enter password';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', 'Download password');
      var btn = h('button', 'fi-ph-btn', 'Unlock');
      btn.type = 'button';
      var submit = function () {
        var pw = input.value.trim();
        if (pw) self.authenticate({ password: pw });
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      form.appendChild(input);
      form.appendChild(btn);
      this.dl.appendChild(form);
      this.unlockBtn = btn;
      this.passwordInput = input;
      if (message) {
        var note = h('p', isHint ? 'fi-ph-note' : 'fi-ph-err', message);
        note.setAttribute('role', 'alert');
        this.dl.appendChild(note);
      }
      if (focus) input.focus();
      return;
    }

    var total = L.photos.length;
    var totalBytes = L.total_bytes || this.chapterList.reduce(function (n, c) { return n + c.bytes; }, 0);
    if (total <= ZIP_MAX) {
      var all = h('button', 'fi-ph-btn fi-ph-btn-primary', 'Download all photos');
      all.type = 'button';
      all.appendChild(h('span', 'fi-ph-sub', plural(total, 'photo') + ', ' + fmtBytes(totalBytes) + ', one zip file'));
      all.addEventListener('click', function () { self.downloadZip(null, total, totalBytes); });
      this.dl.appendChild(all);
    } else {
      this.dl.appendChild(h('p', null, plural(total, 'photo') + ', ' + fmtBytes(totalBytes) +
        '. This gallery is large, so it downloads one chapter at a time.'));
    }

    if (this.chapterList.length > 1 || total > ZIP_MAX) {
      var list = h('div', 'fi-ph-chlist');
      this.chapterList.forEach(function (c) {
        var b = h('button', 'fi-ph-btn');
        b.type = 'button';
        b.appendChild(h('span', null, chapterLabel(c.name)));
        b.appendChild(h('span', 'fi-ph-sub', c.count > ZIP_MAX
          ? plural(c.count, 'photo') + ', too many for one zip'
          : plural(c.count, 'photo') + ', ' + fmtBytes(c.bytes)));
        if (c.count > ZIP_MAX) b.disabled = true;
        b.addEventListener('click', function () { self.downloadZip(c.name, c.count, c.bytes); });
        list.appendChild(b);
      });
      this.dl.appendChild(list);
    }
    this.dl.appendChild(h('p', 'fi-ph-note', 'To save one photo, open it and tap Download full size.'));
  };

  Gallery.prototype.requireToken = function () {
    if (this.hasToken()) return true;
    this.token = null;
    this.close();
    this.renderDownloads('Enter your password above, then tap Download full size again.', true, true);
    this.dl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  };

  Gallery.prototype.downloadZip = function (chapter, count, bytes) {
    if (!this.requireToken()) return;
    var ok = window.confirm(
      'Download ' + plural(count, 'photo') + ' (' + fmtBytes(bytes) + ') as one zip file?\n\n' +
      'Large downloads take a while. Use Wi-Fi and make sure your device has enough free space. ' +
      'Your browser shows the progress in its downloads.'
    );
    if (!ok) return;
    var url = this.base + '/zip?t=' + encodeURIComponent(this.token);
    if (chapter !== null) url += '&chapter=' + encodeURIComponent(chapter);
    navigateTo(url);
  };

  Gallery.prototype.downloadOriginal = function (photo) {
    if (!this.requireToken()) return;
    navigateTo(this.base + '/original/' + photo.id + '?t=' + encodeURIComponent(this.token));
  };

  // ---- lightbox -------------------------------------------------------------

  Gallery.prototype.buildLightbox = function () {
    var self = this;
    var lb = h('div', 'fi-ph-lb');
    lb.hidden = true;
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', 'Photo viewer');

    var bar = h('div', 'fi-ph-lb-bar');
    this.lbCount = h('span', 'fi-ph-lb-count');
    this.lbCount.setAttribute('aria-live', 'polite');
    var close = h('button', 'fi-ph-lb-icon');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = ICONS.close;
    bar.appendChild(this.lbCount);
    bar.appendChild(close);

    var stage = h('div', 'fi-ph-lb-stage');
    this.lbImg = document.createElement('img');
    this.lbImg.alt = '';
    stage.appendChild(this.lbImg);
    var prev = h('button', 'fi-ph-lb-icon fi-ph-lb-nav fi-ph-lb-prev');
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous photo');
    prev.innerHTML = ICONS.prev;
    var next = h('button', 'fi-ph-lb-icon fi-ph-lb-nav fi-ph-lb-next');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next photo');
    next.innerHTML = ICONS.next;
    stage.appendChild(prev);
    stage.appendChild(next);

    var foot = h('div', 'fi-ph-lb-foot');
    var dl = h('button', 'fi-ph-lb-dl', 'Download full size');
    dl.type = 'button';
    foot.appendChild(dl);

    lb.appendChild(bar);
    lb.appendChild(stage);
    lb.appendChild(foot);
    document.body.appendChild(lb);

    close.addEventListener('click', function () { self.close(); });
    prev.addEventListener('click', function () { self.step(-1); });
    next.addEventListener('click', function () { self.step(1); });
    dl.addEventListener('click', function () {
      var p = self.visible[self.lbIndex];
      if (p) self.downloadOriginal(p);
    });
    stage.addEventListener('click', function (e) { if (e.target === stage) self.close(); });

    // Swipe left or right to move, down to close. Pinch zoom is left alone.
    var sx = 0, sy = 0, tracking = false;
    stage.addEventListener('touchstart', function (e) {
      tracking = e.touches.length === 1;
      if (tracking) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
    }, { passive: true });
    stage.addEventListener('touchmove', function (e) { if (e.touches.length > 1) tracking = false; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (!tracking || !e.changedTouches.length) return;
      tracking = false;
      if (window.visualViewport && window.visualViewport.scale > 1.05) return;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) self.step(dx < 0 ? 1 : -1);
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) self.close();
    });

    document.addEventListener('keydown', function (e) {
      if (self.lbIndex < 0) return;
      if (e.key === 'Escape') { e.preventDefault(); self.close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); self.step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); self.step(-1); }
      else if (e.key === 'Tab') {
        // Keep focus inside the viewer.
        var f = lb.querySelectorAll('button');
        var vis = [];
        for (var i = 0; i < f.length; i++) if (f[i].offsetParent !== null) vis.push(f[i]);
        if (!vis.length) return;
        var at = vis.indexOf(document.activeElement);
        if (e.shiftKey && at <= 0) { e.preventDefault(); vis[vis.length - 1].focus(); }
        else if (!e.shiftKey && at === vis.length - 1) { e.preventDefault(); vis[0].focus(); }
      }
    });
    // Phone back button closes the viewer instead of leaving the page.
    window.addEventListener('popstate', function () { if (self.lbIndex >= 0) self.hide(); });

    this.lb = lb;
    this.lbClose = close;
  };

  Gallery.prototype.webUrl = function (p) { return this.base + '/web/' + p.id + '.jpg'; };

  Gallery.prototype.open = function (idx) {
    if (!this.lb) this.buildLightbox();
    this.returnFocus = document.activeElement;
    this.lb.hidden = false;
    document.documentElement.classList.add('fi-ph-lock');
    try { history.pushState({ fiPhotoViewer: 1 }, ''); } catch (e) { /* ignore */ }
    this.show(idx);
    this.lbClose.focus();
  };

  Gallery.prototype.show = function (idx) {
    var n = this.visible.length;
    if (!n) return;
    idx = (idx + n) % n;
    this.lbIndex = idx;
    var p = this.visible[idx];
    this.lbImg.width = p.web_w || p.w || 0;
    this.lbImg.height = p.web_h || p.h || 0;
    this.lbImg.src = this.webUrl(p);
    var label = (idx + 1) + ' of ' + n;
    if (p.chapter) label += ', ' + p.chapter;
    this.lbCount.textContent = label;
    // Preload both neighbours so swiping feels instant.
    [idx + 1, idx - 1].forEach(function (j) {
      var q = this.visible[(j + n) % n];
      if (q) { var im = new Image(); im.src = this.webUrl(q); }
    }, this);
  };

  Gallery.prototype.step = function (d) { if (this.lbIndex >= 0) this.show(this.lbIndex + d); };

  Gallery.prototype.close = function () {
    if (this.lbIndex < 0) return;
    if (history.state && history.state.fiPhotoViewer) { history.back(); return; }
    this.hide();
  };

  Gallery.prototype.hide = function () {
    if (!this.lb || this.lbIndex < 0) return;
    this.lbIndex = -1;
    this.lb.hidden = true;
    this.lbImg.removeAttribute('src');
    document.documentElement.classList.remove('fi-ph-lock');
    if (this.returnFocus && this.returnFocus.focus) this.returnFocus.focus();
  };

  function start() {
    var roots = document.querySelectorAll('[data-fi-photos]');
    for (var i = 0; i < roots.length; i++) {
      if (!roots[i].__fiPhotos) roots[i].__fiPhotos = new Gallery(roots[i]);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
