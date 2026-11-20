// The itemized package breakdown on the public pricing pages (calculator,
// experience, saved). Every number comes from the iris-automation Worker
// engine (POST /api/breakdown/quote, the same engine every contract, invoice
// and charge uses); the page never prices a package itself unless this fetch
// fails, and then it keeps its own old rows as a fallback.
//
// window.fiBreakdown.quote(config, onOk, onFail)
//   config: { tier, hours, highlight, teaser, storySession } and nothing else.
//   Debounced (the latest call wins, older answers are dropped), cached per
//   package so tapping back to a package answers instantly. onOk(data) gets
//   { result, breakdownHtml, fomoFreeSpot }; onFail() runs on any error.
// window.fiBreakdown.cached(config) returns the cached answer or null.
// window.fiBreakdown.fmtMoney(n): "$1,234.56", "$1,000", negatives "-$1,000".
(function () {
  if (window.fiBreakdown) return;
  var API = 'https://api.flyiniris.com/api/breakdown/quote';
  var DELAY = 160;
  var cache = {};
  var timer = null;
  var seq = 0;

  function clean(c) {
    return {
      tier: String(c.tier),
      hours: String(c.hours),
      highlight: String(c.highlight),
      teaser: c.teaser === true,
      storySession: c.storySession === true
    };
  }
  function key(c) {
    return [c.tier, c.hours, c.highlight, c.teaser ? 1 : 0, c.storySession ? 1 : 0].join('|');
  }
  function fmtMoney(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    var a = Math.abs(v);
    return (v < 0 ? '-$' : '$') + a.toLocaleString('en-US', { minimumFractionDigits: a % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function quote(config, onOk, onFail) {
    var c = clean(config);
    var k = key(c);
    var my = ++seq;
    if (timer) { clearTimeout(timer); timer = null; }
    if (cache[k]) { onOk(cache[k]); return; }
    timer = setTimeout(function () {
      timer = null;
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c)
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || d.ok !== true || !d.result || typeof d.breakdownHtml !== 'string') throw new Error('bad answer');
          cache[k] = d;
          if (my === seq) onOk(d);
        })
        .catch(function () { if (my === seq && onFail) onFail(); });
    }, DELAY);
  }
  window.fiBreakdown = {
    quote: quote,
    cached: function (config) { return cache[key(clean(config))] || null; },
    fmtMoney: fmtMoney
  };
})();
