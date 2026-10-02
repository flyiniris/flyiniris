/*
 * ChatGPT Ads (OpenAI) Measurement Pixel, added 2026-10-01 for the ChatGPT ads test.
 * Loader + init per https://developers.openai.com/ads/measurement-pixel.
 * Included near the top of <head> on the three inquiry pages (index, /start, /quiz)
 * so the oppref click id from an ad landing is captured into the __oppref cookie.
 * The inquiry submit handlers call oaiq("measure", "lead_created", ...) next to the
 * Meta Lead event, reusing the same event id.
 * CSP: bzrcdn.openai.com (script-src, connect-src) and bzr.openai.com (connect-src,
 * img-src) are in _headers. The pre-push tag manifest checks both.
 * Independent of GTM, GA4, the Meta pixel and Clarity: it touches none of them.
 */
(function (w, d, s, u) {
  if (w.oaiq) return;
  var q = function () {
    q.q.push(arguments);
  };
  q.q = [];
  w.oaiq = q;
  var js = d.createElement(s);
  js.async = true;
  js.src = u;
  var f = d.getElementsByTagName(s)[0];
  f.parentNode.insertBefore(js, f);
})(window, document, "script", "https://bzrcdn.openai.com/sdk/oaiq.min.js");

oaiq("init", {
  pixelId: "Dmmq7HbdA8e75N8dBSfWk7",
});
