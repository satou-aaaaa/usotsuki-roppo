// ひな形（shared-workflows template/qa/sw-check.mjs）。ゲームでは直さず写す。
// sw.js を Node の中で動かし、返事の仕方を確かめる（ブラウザ無し）。qa/run.mjs から checkSwStall(sw の中身) を呼ぶ。
// 時間は100分の1で進める（4秒＝40ms・60秒＝600ms）。見るもの:
//   stalled: 本文の途中で通信が止まっても、4秒ほどで保存したものへ切り替わる（2026-11-07 CodeRabbit）
//   normal:  少し遅い通信（1秒）はネットの返事のまま（amida-haitatsu #14 の CodeRabbit）
//   trickle: 本文が少しずつ（1秒ごとに）届くあいだは待ち、ネットの返事を返す（合計の時間で切らない。chikei-ate #2・pikuto-yomi #1）
//   long:    保存したものが無く、本文が3秒ごとに届いて合わせて75秒かかっても、打ち切らずにネットの返事を返す（#252 の CodeRabbit）
//   nocache: 保存したものも無く通信も止まり、控えの検索まで止まっても、60秒で Response.error() を返す（sekai-jikoku #1・meirei-narabe #1）
//   longKept・nocacheKept: waitUntil は保存し直しが終わるまで続き（75秒でも）、何も届かなければ60秒で終わる（#252 の CodeRabbit）
//   redirect・empty: リダイレクト（status 0）と 204 は、作り直さずそのまま返す（版11の CodeRabbit）
//   down503・downErr: 503 や通信の失敗のあと控えの検索が止まっても、60秒で Response.error() を返す（版11の CodeRabbit）
import vm from "node:vm";

const S = 100; // 時間を縮める倍率

export async function checkSwStall(code) {
  const listeners = {};
  const cached = new Response("cached-page", { status: 200 });
  let mode = "stall";
  let store = "hit"; // hit: 保存がある / hang: 控えの検索が返らない
  let put = false, kept = null; // 保存し直したか / waitUntil が終わったとき保存し直していたか
  const match = async () => (store === "hit" ? cached.clone() : new Promise(() => {}));
  const ctx = {
    self: { addEventListener: (t, f) => (listeners[t] = f), location: { origin: "https://x.test", href: "https://x.test/sw.js", toString: () => "https://x.test/sw.js" }, skipWaiting() {}, clients: { claim() {} } },
    caches: { match, open: async () => ({ match, put: async () => { put = true; }, keys: async () => [], addAll: async () => {} }), keys: async () => [], delete: async () => true },
    fetch: async () => {
      if (mode === "redirect") return { type: "opaqueredirect", status: 0, ok: false, body: null, headers: new Headers() };
      if (mode === "empty") return new Response(null, { status: 204 });
      if (mode === "down503") return new Response("down", { status: 503 });
      if (mode === "downErr") throw new TypeError("offline");
      if (mode === "ok") { await new Promise((r) => setTimeout(r, 1000 / S)); return new Response("net-page", { status: 200 }); }
      if (mode === "trickle" || mode === "long") {
        let n = 0;
        const [count, gap] = mode === "long" ? [24, 3000] : [8, 1000];
        return new Response(new ReadableStream({
          pull(c) { return new Promise((r) => setTimeout(() => { if (n++ < count) c.enqueue(new TextEncoder().encode("net-")); else { c.enqueue(new TextEncoder().encode("page")); c.close(); } r(); }, gap / S)); },
        }), { status: 200 });
      }
      // 見出しは届くが本文が終わらない返事
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("half")); } }), { status: 200 });
    },
    setTimeout: (f, ms) => setTimeout(f, ms / S), clearTimeout, URL, Request, Response, Headers, Promise, Uint8Array, console,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const ask = () => new Promise((resolve) => {
    put = false; kept = null;
    listeners.fetch({ request: { method: "GET", url: "https://x.test/index.html", mode: "navigate" }, waitUntil: (p) => p.then(() => { kept = put; }), respondWith: (p) => p.then(resolve) });
  });
  const within = (ms, f) => Promise.race([ask().then(f), new Promise((r) => setTimeout(() => r("timeout"), ms / S))]);
  // 4秒で切り替わるなら40ms。10秒（100ms）を過ぎたら遅すぎる
  const stalled = await within(10000, (r) => r.text());
  mode = "ok";
  const normal = await within(30000, (r) => r.text());
  mode = "trickle";
  const trickle = await within(30000, (r) => r.text());
  mode = "long"; store = "hang";
  const long = await within(120000, (r) => (r.type === "error" ? "error" : r.text()));
  await new Promise((r) => setTimeout(r, 2000 / S));
  const longKept = kept; // 75秒かかった受信でも、保存し直してから waitUntil が終わる（#252 の CodeRabbit）
  mode = "stall";
  const nocache = await within(75000, (r) => r.type);
  await new Promise((r) => setTimeout(r, 2000 / S));
  const nocacheKept = kept; // 何も届かなくても、60秒で waitUntil が終わる（止まったまま残らない）
  mode = "redirect"; store = "hit";
  const redirect = await within(10000, (r) => r.type);
  mode = "empty";
  const empty = await within(10000, (r) => r.status);
  mode = "down503"; store = "hang";
  const down503 = await within(75000, (r) => r.type);
  mode = "downErr";
  const downErr = await within(75000, (r) => r.type);
  return { stalled, normal, trickle, long, longKept, nocache, nocacheKept, redirect, empty, down503, downErr, ok: stalled === "cached-page" && normal === "net-page" && trickle === "net-net-net-net-net-net-net-net-page" && long === "net-".repeat(24) + "page" && longKept === true && nocache === "error" && nocacheKept === false && redirect === "opaqueredirect" && empty === 204 && down503 === "error" && downErr === "error" };
}
