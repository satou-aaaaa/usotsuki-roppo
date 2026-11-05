// 引き継ぎコード（transfer.js）：このゲームの記録を「コード」と「QR」にして、別の端末へ移す。サーバーは使わない。
// 引き継ぎの版: 3
// 正：satou-aaaaa/shared-workflows の template/transfer.js（各ゲームはこれをそのまま写す。直すときはひな形を直して配り、版を上げる）
// 使い方（index.html の <head> の中、ゲームの script より前に、defer を付けずに置く）:
//   <script src="transfer.js" data-game="kippu-10" data-keys="kippu-v1"></script>
//   data-keys はカンマ区切り。最後が * のものは「その文字で始まるキー全部」（例 xdoko-*）。
//   書くのはこのゲームの記録のキーだけ（a11y-v1 のような全部のゲームで分け合う設定は入れない。取り込むと別のゲームの設定まで変わる）。
//   押すと開く所に data-hk を付ける（<a href="#" data-hk>引き継ぎ</a> など）。JS からは HK.open()。
// しくみ:
//   - 書き出し：記録（localStorage のうち data-keys に合うもの）を JSON → deflate-raw で縮める → base64url。
//     形は HK1.<中身>.<CRC32>（縮められないブラウザは HK0）。QR は「このページの URL#hk=コード」。
//     URL の # より後ろはサーバーへ送られない（MDN「URL: hash」）ので、記録は外へ出ない。
//   - 取り込み：形・CRC・ゲームの名前・キーの名前・大きさ・HTML に使う文字（< > " ' `）が無いかを確かめてから、確認の画面を出す。
//     ゲームは記録を innerHTML に入れることが多いので、作ったコードで画面にスクリプトを入れられないようにする（版2、CodeRabbit の指摘）。
//     入れ替える前の記録は控え（hk-backup:<ゲーム>）に残し、「取り込む前に戻す」で戻せる（戻すのも入れ替えなので、もう一度押せばまた戻る）。
//     ゲームが記録を読む前に入れ替えたいので、sessionStorage に預けてページを読み直し、この script の最初で書き込む。
//   - 外へ通信しない（fetch・XMLHttpRequest・外のスクリプトを使わない）。QR は下の qrcode-generator（MIT）をこのファイルの中で作る。
(function () {
  "use strict";
  var VERSION = 3;
  var me = document.currentScript;
  var cfg = window.HK_CONFIG || {};
  var GAME = cfg.game || (me && me.dataset.game) || "";
  var KEYS = (cfg.keys || (me && me.dataset.keys) || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  var BACKUP = "hk-backup:" + GAME;
  var PENDING = "hk-pending:" + GAME;
  var DONE = "hk-done:" + GAME;
  var MAX_JSON = 4 * 1024 * 1024; // localStorage はおおよそ 5MB まで
  var QR_MAX = 2300; // QR（誤り訂正 L・40型）に入る URL の長さのめやす
  // 全部のゲームで分け合うキー（見やすさの設定）。入れると、取り込んだときにほかのゲームの設定まで変わる
  var SHARED = ["a11y-v1"];
  if (!GAME || !KEYS.length || KEYS.some(function (k) { return k === "*" || /^hk-/.test(k) || SHARED.indexOf(k) >= 0 || (k.slice(-1) === "*" && "a11y-v1".indexOf(k.slice(0, -1)) === 0); })) {
    console.error("transfer.js: data-game と data-keys を書く（* だけ・hk- で始まるキー・分け合う a11y-v1 は使えない）");
    return;
  }

  // ---- 記録の読み書き ----
  function ours(k) {
    if (/^hk-/.test(k)) return false; // 控え・預け物は「h*」のような書き方でも記録に入れない
    return KEYS.some(function (p) { return p.slice(-1) === "*" ? k.indexOf(p.slice(0, -1)) === 0 : k === p; });
  }
  function snapshot() {
    var d = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k != null && ours(k)) d[k] = localStorage.getItem(k);
      }
    } catch (e) { /* 読めないときは空 */ }
    return d;
  }
  function count(d) { return Object.keys(d).length; }
  // d に入れ替える。失敗したら元に戻す
  function replaceAll(d) {
    var old = snapshot();
    try {
      Object.keys(old).forEach(function (k) { localStorage.removeItem(k); });
      Object.keys(d).forEach(function (k) { localStorage.setItem(k, d[k]); });
    } catch (e) {
      try {
        Object.keys(d).forEach(function (k) { localStorage.removeItem(k); });
        Object.keys(old).forEach(function (k) { localStorage.setItem(k, old[k]); });
      } catch (e2) { /* ここまで来たら何もできない */ }
      throw e;
    }
  }
  function readBackup() {
    try { var b = JSON.parse(localStorage.getItem(BACKUP) || "null"); return b && b.d && typeof b.d === "object" ? b : null; } catch (e) { return null; }
  }

  // ---- コードの形 ----
  var CRC = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return ((c ^ 0xffffffff) >>> 0).toString(36);
  }
  function b64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64(s) {
    var bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function pipe(bytes, stream) {
    return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function encode(d) {
    var json = JSON.stringify({ g: GAME, v: VERSION, at: new Date().toISOString(), d: d });
    var raw = new TextEncoder().encode(json);
    // 受け取る側が弾く大きさのコードは作らない（書き出しは成功したのに取り込めない、をなくす）
    if (raw.length > MAX_JSON) return Promise.reject(fail("big"));
    var z;
    try { z = new CompressionStream("deflate-raw"); } catch (e) { z = null; }
    var p = z ? pipe(raw, z).catch(function () { return null; }) : Promise.resolve(null); // 縮められなければ HK0
    return p.then(function (bytes) {
      var mode = bytes ? "1" : "0";
      bytes = bytes || raw;
      return "HK" + mode + "." + b64(bytes) + "." + crc32(bytes);
    });
  }
  // 貼られた文字から、コードの部分だけを取り出す（URL ごと貼っても、改行や空白が混じってもよい）
  function clean(text) {
    var s = String(text || "");
    // URL の途中で改行されていても、コードに使う文字（と改行）が続くあいだは1つのコードとして取る
    var m = s.match(/[#&]hk=([A-Za-z0-9_.%-]+(?:[\r\n]+[A-Za-z0-9_.%-]+)*)/);
    if (m) { try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1]; } }
    return s.replace(/\s+/g, "");
  }
  var ERR = {
    form: "コードの形がちがいます。最後まで写せているか確かめてください。",
    crc: "コードが途中で変わっています（写しまちがい・欠け）。もう一度写してください。",
    old: "このブラウザでは読めないコードです。ブラウザを新しくするか、書き出した端末でもう一度作ってください。",
    game: "別のゲームのコードです。",
    keys: "このゲームの記録ではない中身が入っています。",
    bad: "記録に使わない文字が入っています。書き出した端末でもう一度作ってください。",
    big: "記録が大きすぎます。",
    newer: "新しい版の引き継ぎコードです。ページを読み直して（アプリを開き直して）から試してください。",
  };
  // 記録の中の文字に、HTML の印になる文字が無いか（JSON ならキーと文字の値を全部見る）
  var HTMLCH = /[<>"'`]/;
  function unsafe(v) {
    var o;
    try { o = JSON.parse(v); } catch (e) { return HTMLCH.test(v); }
    var stack = [o];
    while (stack.length) {
      var x = stack.pop();
      if (typeof x === "string") { if (HTMLCH.test(x)) return true; }
      else if (x && typeof x === "object") {
        for (var k in x) { if (HTMLCH.test(k)) return true; stack.push(x[k]); }
      }
    }
    return false;
  }
  function fail(kind) { var e = new Error(ERR[kind]); e.kind = kind; return e; }
  // 縮めたコードを、読みながら大きさを数えて広げる。MAX_JSON を超えたらそこでやめる
  // （小さなコードが何百MBにも膨らむと、開いただけでタブが固まるため。版3、CodeRabbit の指摘）
  function inflate(bytes) {
    var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    var parts = [], total = 0;
    function next() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total), at = 0;
          parts.forEach(function (p) { out.set(p, at); at += p.length; });
          return out;
        }
        total += r.value.length;
        if (total > MAX_JSON) { try { reader.cancel(); } catch (e) { /* なし */ } throw fail("big"); }
        parts.push(r.value);
        return next();
      });
    }
    return next();
  }
  function decode(text) {
    return Promise.resolve().then(function () {
      var s = clean(text);
      if (s.length > MAX_JSON * 2) throw fail("big");
      var m = s.match(/^HK([01])\.([A-Za-z0-9_-]+)\.([0-9a-z]{1,7})$/);
      if (!m) throw fail("form");
      var bytes;
      try { bytes = unb64(m[2]); } catch (e) { throw fail("form"); }
      if (crc32(bytes) !== m[3]) throw fail("crc");
      if (m[1] === "1" && typeof DecompressionStream !== "function") throw fail("old");
      return (m[1] === "1" ? inflate(bytes) : Promise.resolve(bytes)).catch(function (e) { throw e && e.kind ? e : fail("form"); });
    }).then(function (raw) {
      if (raw.length > MAX_JSON) throw fail("big");
      var o;
      try { o = JSON.parse(new TextDecoder().decode(raw)); } catch (e) { throw fail("form"); }
      if (!o || typeof o !== "object" || !o.d || typeof o.d !== "object" || Array.isArray(o.d)) throw fail("form");
      if (o.g !== GAME) throw fail("game");
      if (typeof o.v !== "number" || o.v > VERSION) throw fail("newer");
      var keys = Object.keys(o.d);
      if (!keys.length) throw fail("form");
      keys.forEach(function (k) {
        if (!ours(k) || typeof o.d[k] !== "string") throw fail("keys");
      });
      keys.forEach(function (k) { if (unsafe(o.d[k])) throw fail("bad"); });
      var at = new Date(o.at);
      return { d: o.d, at: isNaN(at) ? null : at };
    });
  }

  // ---- 読み直したときの入れ替え（ゲームが記録を読む前に動く） ----
  (function applyPending() {
    var p;
    try { p = sessionStorage.getItem(PENDING); sessionStorage.removeItem(PENDING); } catch (e) { return; }
    if (!p) return;
    var msg;
    try {
      var job = JSON.parse(p);
      // いまの data-keys の外のキー（前の版の控えに入っていた a11y-v1 など）は書かない
      var d = {};
      Object.keys(job.d || {}).forEach(function (k) { if (ours(k) && typeof job.d[k] === "string") d[k] = job.d[k]; });
      // 全部が外のキーだった（中身が空になった）ときは、いまの記録を消さないよう入れ替えない
      if (!count(d) && count(job.d || {})) throw new Error("data-keys の外のキーだけ");
      job.d = d;
      var cur = snapshot();
      // 先にいまの記録を控えに残す（空なら控えは作らない。前の控えも消さない）。控えを書けなければ入れ替えない
      var prev = localStorage.getItem(BACKUP);
      if (count(cur)) localStorage.setItem(BACKUP, JSON.stringify({ at: new Date().toISOString(), d: cur }));
      try { replaceAll(job.d); } catch (e) {
        try { if (prev == null) localStorage.removeItem(BACKUP); else localStorage.setItem(BACKUP, prev); } catch (e2) { /* なし */ }
        throw e;
      }
      if (!count(cur) && job.undo) { try { localStorage.removeItem(BACKUP); } catch (e) { /* なし */ } }
      msg = job.undo ? "取り込む前の記録に戻しました" : "記録を引き継ぎました";
    } catch (e) {
      msg = "引き継げませんでした（端末の空きが足りないかもしれません）。記録は元のままです";
    }
    try { sessionStorage.setItem(DONE, msg); } catch (e) { /* なし */ }
  })();

  // ---- 画面 ----
  var CSS = [
    ".hk-back{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}",
    // 遊び方などの <dialog> より上に出すため、こちらも <dialog> の showModal（いちばん上の層）で開く
    "dialog.hk-back{border:0;margin:0;width:100%;height:100%;max-width:none;max-height:none;color:inherit}",
    "dialog.hk-back:not([open]){display:none}",
    "dialog.hk-back::backdrop{background:transparent}",
    ".hk-box{--hk-bg:#fff;--hk-fg:#222;--hk-sub:#555;--hk-line:#ccc;--hk-btn:#1f5fbf;--hk-btn-fg:#fff;--hk-err:#b00020;",
    "background:var(--hk-bg);color:var(--hk-fg);width:min(420px,100%);max-height:calc(100vh - 32px);overflow:auto;border-radius:14px;padding:18px 16px;box-sizing:border-box;font:15px/1.6 system-ui,-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;text-align:left}",
    "@media (prefers-color-scheme:dark){.hk-box{--hk-bg:#1e2129;--hk-fg:#eee;--hk-sub:#bbb;--hk-line:#444;--hk-btn:#5b9cff;--hk-btn-fg:#0b1020;--hk-err:#ff8a8a}}",
    ".hk-box h2{font-size:18px;margin:0 0 8px}.hk-box h3{font-size:15px;margin:16px 0 6px}",
    ".hk-box p{margin:6px 0;color:var(--hk-sub);font-size:13px}",
    ".hk-box textarea{width:100%;box-sizing:border-box;min-height:64px;font:12px/1.4 ui-monospace,monospace;border:1px solid var(--hk-line);border-radius:8px;padding:8px;background:transparent;color:inherit;word-break:break-all}",
    ".hk-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}",
    ".hk-box button,.hk-box label.hk-file{min-height:44px;min-width:44px;padding:8px 14px;border-radius:10px;border:1px solid var(--hk-line);background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box}",
    ".hk-box button.hk-main{background:var(--hk-btn);color:var(--hk-btn-fg);border-color:var(--hk-btn);font-weight:bold}",
    ".hk-box button:focus-visible,.hk-box textarea:focus-visible,.hk-box label.hk-file:focus-within{outline:3px solid var(--hk-btn);outline-offset:2px}",
    ".hk-qr{display:block;width:min(220px,70%);margin:6px auto;background:#fff;padding:8px;border-radius:8px}",
    ".hk-qr svg{display:block;width:100%;height:auto}",
    ".hk-box [hidden]{display:none!important}",
    ".hk-err{color:var(--hk-err)!important;font-weight:bold}",
    ".hk-file input{position:absolute;width:1px;height:1px;opacity:0}",
    ".hk-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483001;background:#222;color:#fff;padding:12px 18px;border-radius:12px;font:14px/1.5 system-ui,sans-serif;max-width:calc(100% - 32px)}",
  ].join("\n");
  var back = null, lastFocus = null, req = 0;
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function style() {
    if (document.getElementById("hk-style")) return;
    var s = el("style", { id: "hk-style" });
    s.textContent = CSS;
    document.head.appendChild(s);
  }
  function toast(text) {
    style();
    var t = el("div", { class: "hk-toast", role: "status", text: text });
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  }
  function close() {
    req++; // 読み取り中のコードの結果は、閉じたあとに画面へ出さない
    if (!back) return;
    back.parentNode.removeChild(back);
    back = null;
    document.removeEventListener("keydown", onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (!back) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    var f = back.querySelectorAll("button,textarea,input,[href]");
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  // 箱を開いて中身を入れかえる
  function show(kids, focusSel) {
    style();
    if (!back) {
      lastFocus = document.activeElement;
      var modal = typeof HTMLDialogElement === "function" && typeof HTMLDialogElement.prototype.showModal === "function";
      back = el(modal ? "dialog" : "div", { class: "hk-back" });
      back.addEventListener("click", function (e) { if (e.target === back) close(); });
      back.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
      document.body.appendChild(back);
      if (modal) back.showModal();
      document.addEventListener("keydown", onKey, true);
    }
    back.innerHTML = "";
    var box = el("div", { class: "hk-box", role: "dialog", "aria-modal": "true", "aria-labelledby": "hk-title" }, kids);
    back.appendChild(box);
    var f = box.querySelector(focusSel || "button");
    if (f) f.focus();
  }
  function btn(text, onClick, main, id) {
    var b = el("button", { type: "button", text: text });
    if (main) b.className = "hk-main";
    if (id) b.id = id;
    b.addEventListener("click", onClick);
    return b;
  }
  function when(d) {
    if (!d) return "日時のわからない";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0") + " に作った";
  }
  function url(code) { return location.href.replace(/[?#].*$/, "") + "#hk=" + code; }
  function qrSvg(text) {
    var q = qrcode(0, "L");
    q.addData(text, "Byte");
    q.make();
    var n = q.getModuleCount(), m = 2, s = n + m * 2, d = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) d += "M" + (c + m) + "," + (r + m) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + " " + s + '" shape-rendering="crispEdges" role="img" aria-label="引き継ぎの QR コード"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  function copy(text, b) {
    var done = function () { b.textContent = "コピーしました"; setTimeout(function () { b.textContent = "コピー"; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var t = el("textarea");
      var box = back || document.body; // 開いている箱の外は押せない（inert）ことがあるので箱の中に置く
      t.value = text; box.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      box.removeChild(t);
      if (ok) done(); else { b.textContent = "下のコードを選んでコピーしてください"; setTimeout(function () { b.textContent = "コピー"; }, 4000); }
    }
  }
  function save(code) {
    var a = el("a", { download: GAME + "-引き継ぎ.txt" });
    a.href = URL.createObjectURL(new Blob([url(code) + "\n"], { type: "text/plain" }));
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  // 読み直して、ゲームが記録を読む前に入れ替える
  function commit(d, undo) {
    try { sessionStorage.setItem(PENDING, JSON.stringify({ d: d, undo: !!undo })); }
    catch (e) { return false; }
    location.replace(location.href.split("#")[0]);
    return true;
  }

  function open() {
    var d = snapshot();
    var err = el("p", { class: "hk-err", role: "alert", hidden: "" });
    var paste = el("textarea", { id: "hk-in", "aria-label": "引き継ぎコードを貼る", placeholder: "ここに引き継ぎコードを貼る", autocomplete: "off", spellcheck: "false" });
    var fileIn = el("input", { type: "file", accept: ".txt,text/plain" });
    fileIn.addEventListener("change", function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      if (f.size > MAX_JSON * 2) { err.textContent = ERR.big; err.hidden = false; return; }
      f.text().then(function (t) { paste.value = t; tryImport(); }, function () { err.textContent = ERR.form; err.hidden = false; });
    });
    function tryImport() {
      err.hidden = true;
      var my = ++req; // 後から押したほうだけを使う（古い結果で上書きしない）
      decode(paste.value).then(function (r) { if (my === req) confirmImport(r); }, function (e) { if (my !== req) return; err.textContent = e.kind ? e.message : ERR.form; err.hidden = false; });
    }
    var sendPart = [el("h3", { text: "この端末の記録を送る" })];
    if (!count(d)) sendPart.push(el("p", { text: "まだ記録がありません。" }));
    else {
      var qr = el("div", { class: "hk-qr", id: "hk-qr" });
      var out = el("textarea", { id: "hk-code", readonly: "", "aria-label": "引き継ぎコード" });
      var note = el("p", { text: "新しい端末のカメラで QR を読むと、このゲームが開いて取り込めます。" });
      var copyBtn = btn("コピー", function () { copy(url(out.value), copyBtn); });
      var saveBtn = btn("ファイルに保存", function () { save(out.value); });
      copyBtn.disabled = saveBtn.disabled = true;
      sendPart.push(qr, note, out, el("div", { class: "hk-row" }, [copyBtn, saveBtn]));
      encode(d).then(function (code) {
        out.value = code;
        copyBtn.disabled = saveBtn.disabled = false;
        var u = url(code);
        if (u.length <= QR_MAX) { try { qr.innerHTML = qrSvg(u); } catch (e) { qr.hidden = true; } }
        else { qr.hidden = true; note.textContent = "記録が多いので QR に入りません。コードをコピーするか、ファイルで送ってください。"; }
      }, function (e) { note.textContent = e && e.kind === "big" ? "記録が大きすぎて、コードにできません。" : "コードを作れませんでした。"; });
    }
    var getPart = [
      el("h3", { text: "記録を受け取る" }),
      el("p", { text: "ホーム画面に置いたアプリで遊ぶときは、そのアプリの中でここにコードを貼ります（iPhone はブラウザとアプリで記録が別です）。" }),
      paste, err,
      el("div", { class: "hk-row" }, [btn("取り込む", tryImport, true, "hk-go"), el("label", { class: "hk-file" }, [document.createTextNode("ファイルを開く"), fileIn])]),
    ];
    var b = readBackup();
    var undoPart = b ? [el("h3", { text: "取り込む前に戻す" }), el("p", { text: when(new Date(b.at)).replace("に作った", "の控え") + "があります。" }),
      el("div", { class: "hk-row" }, [btn("控えに戻す", function () { confirmUndo(b); }, false, "hk-undo")])] : [];
    show([el("h2", { id: "hk-title", text: "引き継ぎ" })].concat(sendPart, getPart, undoPart, [el("div", { class: "hk-row" }, [btn("閉じる", close, false, "hk-close")])]),
      count(d) ? "#hk-close" : "#hk-in");
  }
  function confirmImport(r) {
    var cur = count(snapshot());
    var err = el("p", { class: "hk-err", role: "alert", hidden: "" });
    show([
      el("h2", { id: "hk-title", text: "記録を入れ替えますか？" }),
      el("p", { text: when(r.at) + "記録です。" }),
      el("p", { text: cur ? "この端末の今の記録と入れ替えます。今の記録は控えに残すので、あとで「引き継ぎ」から戻せます。" : "この端末にはまだ記録がありません。" }),
      err,
      el("div", { class: "hk-row" }, [
        btn("入れ替える", function () { if (!commit(r.d)) { err.textContent = "取り込めませんでした（ブラウザの設定で保存が止められているかもしれません）。"; err.hidden = false; } }, true, "hk-yes"),
        btn("やめる", close, false, "hk-no"),
      ]),
    ], "#hk-no");
  }
  function confirmUndo(b) {
    var err = el("p", { class: "hk-err", role: "alert", hidden: "" });
    show([
      el("h2", { id: "hk-title", text: "控えに戻しますか？" }),
      el("p", { text: "今の記録と、" + when(new Date(b.at)).replace("に作った", "の控え") + "を入れ替えます。もう一度押せば、また入れ替わります。" }),
      err,
      el("div", { class: "hk-row" }, [btn("戻す", function () { if (!commit(b.d, true)) { err.textContent = "戻せませんでした（ブラウザの設定で保存が止められているかもしれません）。"; err.hidden = false; } }, true, "hk-yes"), btn("やめる", close, false, "hk-no")]),
    ], "#hk-no");
  }

  function boot() {
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest("[data-hk]");
      if (!t) return;
      e.preventDefault();
      open();
    });
    var msg = null;
    try { msg = sessionStorage.getItem(DONE); sessionStorage.removeItem(DONE); } catch (e) { /* なし */ }
    if (msg) toast(msg);
    checkHash();
    window.addEventListener("hashchange", checkHash);
  }
  // QR の URL（#hk=コード）で開かれたら、取り込みの確認を出す（開いている画面で URL が変わったときも）
  function checkHash() {
    var h = location.hash.match(/^#hk=(.+)$/);
    if (!h) return;
    history.replaceState(null, "", location.pathname + location.search);
    var my = ++req;
    decode(h[1]).then(function (r) { if (my === req) confirmImport(r); }, function (e) {
      if (my !== req) return;
      show([el("h2", { id: "hk-title", text: "引き継ぎ" }), el("p", { class: "hk-err", role: "alert", text: e.kind ? e.message : ERR.form }),
        el("div", { class: "hk-row" }, [btn("閉じる", close, true, "hk-close")])]);
    });
  }
  // ---- ここから下は qrcode-generator 2.0.4（https://github.com/kazuhikoarase/qrcode-generator、MIT）をそのまま入れたもの（注釈の行だけ省いた） ----
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------
var qrcode = function() {
  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {
    var PAD0 = 0xEC;
    var PAD1 = 0x11;
    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];
    var _this = {};
    var makeImpl = function(test, maskPattern) {
      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);
      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);
      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }
      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }
      mapData(_dataCache, maskPattern);
    };
    var setupPositionProbePattern = function(row, col) {
      for (var r = -1; r <= 7; r += 1) {
        if (row + r <= -1 || _moduleCount <= row + r) continue;
        for (var c = -1; c <= 7; c += 1) {
          if (col + c <= -1 || _moduleCount <= col + c) continue;
          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };
    var getBestMaskPattern = function() {
      var minLostPoint = 0;
      var pattern = 0;
      for (var i = 0; i < 8; i += 1) {
        makeImpl(true, i);
        var lostPoint = QRUtil.getLostPoint(_this);
        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }
      return pattern;
    };
    var setupTimingPattern = function() {
      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }
      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };
    var setupPositionAdjustPattern = function() {
      var pos = QRUtil.getPatternPosition(_typeNumber);
      for (var i = 0; i < pos.length; i += 1) {
        for (var j = 0; j < pos.length; j += 1) {
          var row = pos[i];
          var col = pos[j];
          if (_modules[row][col] != null) {
            continue;
          }
          for (var r = -2; r <= 2; r += 1) {
            for (var c = -2; c <= 2; c += 1) {
              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };
    var setupTypeNumber = function(test) {
      var bits = QRUtil.getBCHTypeNumber(_typeNumber);
      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }
      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };
    var setupTypeInfo = function(test, maskPattern) {
      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);
      for (var i = 0; i < 15; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }
      for (var i = 0; i < 15; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }
      _modules[_moduleCount - 8][8] = (!test);
    };
    var mapData = function(data, maskPattern) {
      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);
      for (var col = _moduleCount - 1; col > 0; col -= 2) {
        if (col == 6) col -= 1;
        while (true) {
          for (var c = 0; c < 2; c += 1) {
            if (_modules[row][col - c] == null) {
              var dark = false;
              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }
              var mask = maskFunc(row, col - c);
              if (mask) {
                dark = !dark;
              }
              _modules[row][col - c] = dark;
              bitIndex -= 1;
              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };
    var createBytes = function(buffer, rsBlocks) {
      var offset = 0;
      var maxDcCount = 0;
      var maxEcCount = 0;
      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);
      for (var r = 0; r < rsBlocks.length; r += 1) {
        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);
        dcdata[r] = new Array(dcCount);
        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;
        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }
      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }
      var data = new Array(totalCodeCount);
      var index = 0;
      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }
      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }
      return data;
    };
    var createData = function(typeNumber, errorCorrectionLevel, dataList) {
      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);
      var buffer = qrBitBuffer();
      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }
      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }
      while (true) {
        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);
        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }
      return createBytes(buffer, rsBlocks);
    };
    _this.addData = function(data, mode) {
      mode = mode || 'Byte';
      var newData = null;
      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }
      _dataList.push(newData);
      _dataCache = null;
    };
    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };
    _this.getModuleCount = function() {
      return _moduleCount;
    };
    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;
        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();
          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }
          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }
          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }
        _typeNumber = typeNumber;
      }
      makeImpl(false, getBestMaskPattern() );
    };
    _this.createTableTag = function(cellSize, margin) {
      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;
      var qrHtml = '';
      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';
      for (var r = 0; r < _this.getModuleCount(); r += 1) {
        qrHtml += '<tr>';
        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }
        qrHtml += '</tr>';
      }
      qrHtml += '</tbody>';
      qrHtml += '</table>';
      return qrHtml;
    };
    _this.createSvgTag = function(cellSize, margin, alt, title) {
      var opts = {};
      if (typeof arguments[0] == 'object') {
        opts = arguments[0];
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }
      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;
      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;
      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';
      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';
      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }
      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';
      return qrSvg;
    };
    _this.createDataURL = function(cellSize, margin) {
      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;
      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;
      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };
    _this.createImgTag = function(cellSize, margin, alt) {
      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;
      var size = _this.getModuleCount() * cellSize + margin * 2;
      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';
      return img;
    };
    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };
    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;
      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;
      var y, x, r1, r2, p;
      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };
      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };
      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';
          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }
          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }
        ascii += '\n';
      }
      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }
      return ascii.substring(0, ascii.length-1);
    };
    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;
      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }
      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;
      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;
      var y, x, r, p;
      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');
      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;
          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }
          line += p ? white : black;
        }
        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }
      return ascii.substring(0, ascii.length-1);
    };
    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }
    return _this;
  };
  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];
  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {
    var unicodeMap = function() {
      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };
      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }
      return unicodeMap;
    }();
    var unknownChar = '?'.charCodeAt(0);
    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              bytes.push(b);
            } else {
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };
  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };
  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };
  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };
  var QRUtil = function() {
    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
    var _this = {};
    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };
    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };
    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };
    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };
    _this.getMaskFunction = function(maskPattern) {
      switch (maskPattern) {
      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };
      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };
    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };
    _this.getLengthInBits = function(mode, type) {
      if (1 <= type && type < 10) {
        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }
      } else if (type < 27) {
        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }
      } else if (type < 41) {
        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }
      } else {
        throw 'type:' + type;
      }
    };
    _this.getLostPoint = function(qrcode) {
      var moduleCount = qrcode.getModuleCount();
      var lostPoint = 0;
      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {
          var sameCount = 0;
          var dark = qrcode.isDark(row, col);
          for (var r = -1; r <= 1; r += 1) {
            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }
            for (var c = -1; c <= 1; c += 1) {
              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }
              if (r == 0 && c == 0) {
                continue;
              }
              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }
          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };
      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }
      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }
      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }
      var darkCount = 0;
      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }
      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;
      return lostPoint;
    };
    return _this;
  }();
  var QRMath = function() {
    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }
    var _this = {};
    _this.glog = function(n) {
      if (n < 1) {
        throw 'glog(' + n + ')';
      }
      return LOG_TABLE[n];
    };
    _this.gexp = function(n) {
      while (n < 0) {
        n += 255;
      }
      while (n >= 256) {
        n -= 255;
      }
      return EXP_TABLE[n];
    };
    return _this;
  }();
  function qrPolynomial(num, shift) {
    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }
    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();
    var _this = {};
    _this.getAt = function(index) {
      return _num[index];
    };
    _this.getLength = function() {
      return _num.length;
    };
    _this.multiply = function(e) {
      var num = new Array(_this.getLength() + e.getLength() - 1);
      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }
      return qrPolynomial(num, 0);
    };
    _this.mod = function(e) {
      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }
      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );
      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }
      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }
      return qrPolynomial(num, 0).mod(e);
    };
    return _this;
  };
  var QRRSBlock = function() {
    var RS_BLOCK_TABLE = [
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];
    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };
    var _this = {};
    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };
    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }
      var length = rsBlock.length / 3;
      var list = [];
      for (var i = 0; i < length; i += 1) {
        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];
        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }
      return list;
    };
    return _this;
  }();
  var qrBitBuffer = function() {
    var _buffer = [];
    var _length = 0;
    var _this = {};
    _this.getBuffer = function() {
      return _buffer;
    };
    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };
    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };
    _this.getLengthInBits = function() {
      return _length;
    };
    _this.putBit = function(bit) {
      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }
      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }
      _length += 1;
    };
    return _this;
  };
  var qrNumber = function(data) {
    var _mode = QRMode.MODE_NUMBER;
    var _data = data;
    var _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return _data.length;
    };
    _this.write = function(buffer) {
      var data = _data;
      var i = 0;
      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }
      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };
    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };
    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };
    return _this;
  };
  var qrAlphaNum = function(data) {
    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;
    var _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return _data.length;
    };
    _this.write = function(buffer) {
      var s = _data;
      var i = 0;
      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }
      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };
    var getCode = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };
    return _this;
  };
  var qr8BitByte = function(data) {
    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);
    var _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return _bytes.length;
    };
    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };
    return _this;
  };
  var qrKanji = function(data) {
    var _mode = QRMode.MODE_KANJI;
    var _data = data;
    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);
    var _bytes = stringToBytes(data);
    var _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };
    _this.write = function(buffer) {
      var data = _bytes;
      var i = 0;
      while (i + 1 < data.length) {
        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);
        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }
        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);
        buffer.put(c, 13);
        i += 2;
      }
      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };
    return _this;
  };
  var byteArrayOutputStream = function() {
    var _bytes = [];
    var _this = {};
    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };
    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };
    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };
    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };
    _this.toByteArray = function() {
      return _bytes;
    };
    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };
    return _this;
  };
  var base64EncodeOutputStream = function() {
    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';
    var _this = {};
    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };
    var encode = function(n) {
      if (n < 0) {
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };
    _this.writeByte = function(n) {
      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;
      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };
    _this.flush = function() {
      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }
      if (_length % 3 != 0) {
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };
    _this.toString = function() {
      return _base64;
    };
    return _this;
  };
  var base64DecodeInputStream = function(str) {
    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;
    var _this = {};
    _this.read = function() {
      while (_buflen < 8) {
        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }
        var c = _str.charAt(_pos);
        _pos += 1;
        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          continue;
        }
        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }
      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };
    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };
    return _this;
  };
  var gifImage = function(width, height) {
    var _width = width;
    var _height = height;
    var _data = new Array(width * height);
    var _this = {};
    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };
    _this.write = function(out) {
      out.writeString('GIF87a');
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);
      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);
      out.writeByte(lzwMinCodeSize);
      var offset = 0;
      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }
      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);
      out.writeString(';');
    };
    var bitOutputStream = function(out) {
      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;
      var _this = {};
      _this.write = function(data, length) {
        if ( (data >>> length) != 0) {
          throw 'length over';
        }
        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }
        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };
      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };
      return _this;
    };
    var getLZWRaster = function(lzwMinCodeSize) {
      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;
      var table = lzwTable();
      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );
      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);
      bitOut.write(clearCode, bitLength);
      var dataIndex = 0;
      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      while (dataIndex < _data.length) {
        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;
        if (table.contains(s + c) ) {
          s = s + c;
        } else {
          bitOut.write(table.indexOf(s), bitLength);
          if (table.size() < 0xfff) {
            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }
            table.add(s + c);
          }
          s = c;
        }
      }
      bitOut.write(table.indexOf(s), bitLength);
      bitOut.write(endCode, bitLength);
      bitOut.flush();
      return byteOut.toByteArray();
    };
    var lzwTable = function() {
      var _map = {};
      var _size = 0;
      var _this = {};
      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };
      _this.size = function() {
        return _size;
      };
      _this.indexOf = function(key) {
        return _map[key];
      };
      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };
      return _this;
    };
    return _this;
  };
  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }
    var b = byteArrayOutputStream();
    gif.write(b);
    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();
    return 'data:image/gif;base64,' + base64;
  };
  return qrcode;
}();
!function() {
  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        else {
          i++;
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };
}();
  // ---- ここまで qrcode-generator ----

  window.HK = { open: open, encode: function () { return encode(snapshot()); }, decode: decode, version: VERSION };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

})();
