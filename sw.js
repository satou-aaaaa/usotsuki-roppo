// ゲームを端末に保存して、電波が無くても遊べるようにする（PWA）。
// 画面は先にネットを見て、つながらないときだけ保存したものを使う（直した版がすぐ届く）。
// 記録（localStorage）には触らない。外へ何も送らない（よそのサイト＝文字の取り寄せは扱わない）。
// ひな形: satou-aaaaa/shared-workflows の template/sw.js。ゲームで直すのは game:begin〜game:end の間だけ。
//   ほかを直すときはひな形を直し、node scripts/sync-template.mjs <ゲームのフォルダ> で写す（間は残る）。
// ひな形の版: 1（上げたら写しの版も上げる。scripts/drift-check.mjs が古い写し・ひな形とちがう写しを週次まとめに出す）
//   1: 28本が写し合いで28通りになっていたのを1つにした（2026-11-07 shared-workflows #219）。本文の止まりを進み具合で見る・
//      控えも通信も止まったら60秒でタイマーから直接 Response.error() を返す・? 付きの URL を同じ1つに保存する・
//      保存したものは自分の版（cacheName）からだけ探す・入れるときは HTTP の保存を通さない（cache: "reload"）・
//      長い受信でも保存し直しが終わるまで waitUntil で待つ
// game:begin
const CACHE = "roppo-v12";
const SHELL = ["./", "./index.html", "./classic.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./transfer.js"];
// game:end

// 同じゲームの古い版（<名前>-v<数字>）だけを消す。同じサイトのほかのゲーム（kotowaza- と kotowaza-bamen- など）の保存には触らない
const PREFIX = CACHE.replace(/v\d+$/, "");
const base = self.location.href || self.location.origin + "/";
const KEEP = new Set(SHELL.map((u) => new URL(u, base).pathname)); // 保存し直すのは画面のファイルだけ
const INDEX = new URL("./index.html", base).pathname;
const IDLE = 4000; // 本文がこれだけ止まったら保存したものに切り替える（少しずつでも届いていれば待つ）
const LIMIT = 60000; // 保存したものも無く、これだけ何も届かなければ Response.error() を返す（少しずつでも届いていれば待つ）

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && /^v\d+$/.test(k.slice(PREFIX.length)) && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => caches.open(CACHE)).then((c) => c.keys().then((reqs) => Promise.all(reqs.filter((r) => { const u = new URL(r.url); return !KEEP.has(u.pathname) || u.search; }).map((r) => c.delete(r)))))
    .catch(() => {})
    .then(() => self.clients.claim()));
});

// 本文を読み切る。かたまりが届くたびに止まりの時計を戻す（合計の時間では見ない）。止まったら idle()、届くたびに moved() を呼ぶ
function readAll(res, idle, moved) {
  if (!res.body || !res.body.getReader) return res.arrayBuffer();
  const reader = res.body.getReader();
  const parts = [];
  let timer = setTimeout(idle, IDLE);
  const pump = () => reader.read().then(({ done, value }) => {
    clearTimeout(timer);
    if (done) {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
      return out.buffer;
    }
    parts.push(value); moved(); timer = setTimeout(idle, IDLE);
    return pump();
  }, (err) => { clearTimeout(timer); throw err; });
  return pump();
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 自分の版の保存からだけ探す（消す前の古い版の画面を返さない）。読めなくても必ず返事を返す
  const fromCache = () => caches.open(CACHE)
    .then((c) => c.match(url.pathname).then((hit) => hit || (req.mode === "navigate" ? c.match(INDEX) : undefined)))
    .catch(() => undefined);
  let saved = () => {};
  // 保存し直しが終わるまで待つ。少しずつでも届いていれば60秒を過ぎても待つ（受信の途中で止まると保存が残らない。#252 の CodeRabbit）。
  // 何も届かないまま60秒たったら、下の cap の時計で終える
  e.waitUntil(new Promise((r) => { saved = r; }));
  e.respondWith(new Promise((resolve) => {
    let sent = false;
    let cap = 0;
    const send = (r) => { if (sent) return; sent = true; clearTimeout(first); resolve(r); };
    const done = () => { clearTimeout(cap); saved(); };
    // 最後の返事。控えの検索も待たない（どちらも止まっても返す）。何か届くたびに時計を戻す（大きなファイルの受信を打ち切らない。#252 の CodeRabbit）
    // 返したあとも、受信と保存し直しを見張る（止まったら waitUntil を終える）
    const arm = () => { clearTimeout(cap); cap = setTimeout(() => { send(Response.error()); saved(); }, LIMIT); };
    const fallback = () => fromCache().then((hit) => hit && send(hit)); // 保存したものがあれば切り替える（無ければネットを待ち続ける）
    const first = setTimeout(fallback, IDLE); // 見出しが4秒届かないとき
    arm();
    fetch(req).then((res) => {
      clearTimeout(first); arm();
      // 本文を持てない返事（リダイレクト＝status 0・204・205・304）は作り直さずそのまま返す（作り直すと例外になり、末尾の / の無い URL が開けない。版11の CodeRabbit）
      if (res.status === 0 || res.status === 204 || res.status === 205 || res.status === 304) { send(res); return done(); }
      return readAll(res, fallback, arm).then((buf) => {
        const make = () => new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
        if (res.ok) {
          send(make());
          if (!KEEP.has(url.pathname)) return done();
          return caches.open(CACHE).then((c) => c.put(url.pathname, make())).catch(() => {}).then(done);
        }
        // 控えの検索が止まっても cap の時計で返すよう、返してから時計を止める（版11の CodeRabbit）
        if (res.status >= 500) return fromCache().then((hit) => send(hit || make())).then(done);
        send(make());
        done();
      });
    }).catch(() => fromCache().then((hit) => send(hit || Response.error())).then(done));
  }));
});
