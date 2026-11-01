// うそつき六法を端末に保存して、電波が無くても遊べるようにする（PWA）。
// 画面は先にネットを見て、つながらないときだけ保存したものを使う（直した版がすぐ届く）。
// 文字（Google Fonts）は一度取ったら保存したものを使う。記録（localStorage）には触らない。外へ何も送らない。
const CACHE = "roppo-v2";
const FONT_CACHE = "roppo-fonts";
const SHELL = ["./", "./index.html", "./classic.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("roppo-") && k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONT_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      // 保存し終えるまで sw を止めさせない（途中で止まると次に電波が無いとき文字が欠ける）
      if (res.ok || res.type === "opaque") e.waitUntil(c.put(req, res.clone()));
      return res;
    }))));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // サーバーが 5xx を返したときも、保存したものがあればそちらを出す（fetch は HTTP の失敗では例外にならない）
  const fromCache = () => caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined));
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy))); return res; }
    if (res.status >= 500) return fromCache().then((hit) => hit || res);
    return res;
  }, () => fromCache().then((hit) => hit || Response.error())));
});
