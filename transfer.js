// 引き継ぎコード（transfer.js）：このゲームの記録を「コード」と「QR」にして、別の端末へ移す。サーバーは使わない。
// 引き継ぎの版: 15
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
//   - 外へ通信しない（fetch・XMLHttpRequest・外のスクリプトを使わない）。QR は同じ場所の transfer-qr.js（qrcode-generator、MIT）で、箱を開いたときにだけ読む（版14）。
//   - 版7（2026-11-07 CodeRabbit。shared-workflows incidents/2026-11-07-game-template-review-gaps.md）:
//     記録の保存（localStorage.setItem）に失敗したままのキーがあると、古い記録のコードを作らず知らせる・
//     とても長い貼りつけは、CRC や広げる前に弾く・縮めないコード（HK0）も選べる（広げられない古いブラウザへ送るとき）・
//     コピーの代わりの道（execCommand）のあと、押したボタンに戻る・コードの途中の空白も読む・
//     入れ替えたら同じゲームのほかのタブを読み直させる（古いタブの手元の記録で上書きしない）。
//   - 版8（2026-11-07 CodeRabbit。gogen-suiri #1・mukashi-narabe #1）: 縮めないコード（HK0）は、base64 を戻す前に長さで弾く・
//     控えに戻したとき、戻す前が空でも「空の記録」を控えに残す（もう一度押せば空に戻せる。前は控えごと消えて行き来できなかった）。
//   - 版9（2026-11-07 CodeRabbit。sagi-minuki #2・tenkizu-yomi #25）: 行が分かれたコードを試すとき（whole）も、HK0 は戻す前に長さで弾く。
//   - 版10（2026-11-07 shared-workflows #219 にためた CodeRabbit の指摘）:
//     控えに戻す前に、いまの記録を別のキー（hk-prev:<ゲーム>）に書く。書けなければ戻さない（途中で止まっても記録が消えない）・
//     入れ替えたら番号（hk-sync）を進め、前の番号で開いたタブはゲームの保存を書かずに読み直す（知らせが届かなくても古い記録で上書きしない）・
//     保存に失敗したままの間は、入れ替え・控えに戻すを止める（手元にだけある最新の記録が消える）・
//     貼りつけは1回だけつなぎ、先頭の1語も試す（コードの後ろに言葉が9語以上続いても読む）・作り直すときは記録を読み直し、作り終えたところで保存の失敗も見直す・
//     コピーの代わりの道は、箱を閉じたあとならボタンにフォーカスを戻さない。
//   - 版11（2026-11-07 shared-workflows #219。nijushi-sekki #4・meirei-narabe #4 の CodeRabbit）:
//     途中で止まって残った戻す前の記録（hk-prev:）が壊れていたら使わず、いまの記録から作り直す（壊れた値を控えにすると、いまの記録が消える）・
//     途中で止まったあとに記録が変わっていたら、残った記録へ戻すときも、いまの記録を控えにする（あとから遊んだ分が消えない。止まったときの記録の印は hk-prevfp:）・
//     入れ替えの番号は、入れ替えに失敗したら元に戻す（記録は変わらないのに、ほかのタブの保存が捨てられる）・
//     古いタブの保存を捨てたときは、帯（#hk-stale-tab）で「保存できない・読み直して」と知らせる（読み直しが遅れても、黙って記録が消えない）・
//     読み直しが例外で止まったら、次の保存でまた読み直す。
//   - 版12（2026-11-07 dento-kogei #5 などの CodeRabbit）: 控え（hk-backup:・hk-prev:）の d が配列なら記録として使わない。
//   - 版13（2026-11-17 hatsuden-kurabe #1・nenkin-shikumi #1 の CodeRabbit）:
//     入れ替えの番号を進めてから、控えにする記録を読む（番号を進める前に別のタブが保存した分を、控えに入れずに消していた）・
//     控えを書けず、戻すのも途中で止まったときも、止まったときの記録の印（hk-prevfp:）を残す・
//     保存に失敗したままの記録があるタブは、別のタブで入れ替えても自動では読み直さず、帯で知らせる（読み直すと手元の記録が消える）・
//     保存した直後に番号が変わっていたら（別のタブの入れ替えと重なった）、印（hk-race:<ゲーム>:<番号>）を残して、入れ替えた側にも知らせる。印を書けなければ読み直さずに帯で知らせる
//     （localStorage にはタブをまたぐ鍵が無く、確かめてから書くまでの間は閉じられない。混ざったかもしれないと知らせ、取り込み直せるようにする）。
//   - 版14（2026-11-21）: QR を作る部品（約 65KB）を transfer-qr.js に分け、箱を開いたときにだけ読む。transfer.js はゲームの前に
//     すぐ読む（取り込みをゲームより先に書くため）ので、毎回の表示を止める量を減らす（Chrome Lighthouse「Eliminate render-blocking resources」）。
//     QR の部品を読めない（電波が無く保存もしていない）ときは、QR だけ出さずにコードで渡せるようにする。
//   - 版15（2026-11-27 kawagoe-1day #1 の CodeRabbit。shared-workflows incidents/2026-11-27-transfer-midswap-tab.md）:
//     入れ替えの番号は、書き換えの前（…​.w）と、書き換え終わったあと（…​.d）の2回進める。書き換えの途中で開いたタブは
//     新しい番号と古い記録を持つので、終わったあとの番号で古いタブとして扱う（前は古い記録で取り込んだ記録を上書きできた）・
//     止まったあとに遊んだ記録など、戻す先とちがういまの記録を控えにするときは、戻す前に別のキー（hk-next:<ゲーム>）に書く。
//     書けなければ戻さない（控えを書けず元にも戻せないと、いまの記録がメモリにしか無く消えていた）。readBackup はこれも控えとして出す。
(function () {
  "use strict";
  var VERSION = 4; // コードの形の版（形を変えたときだけ上げる。上の「引き継ぎの版」とは別）
  var me = document.currentScript;
  var cfg = window.HK_CONFIG || {};
  var GAME = cfg.game || (me && me.dataset.game) || "";
  var KEYS = (cfg.keys || (me && me.dataset.keys) || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  var BACKUP = "hk-backup:" + GAME;
  var PENDING = "hk-pending:" + GAME;
  var DONE = "hk-done:" + GAME;
  var SYNC = "hk-sync:" + GAME; // 入れ替えたことをほかのタブへ知らせる印・入れ替えの番号（記録には入れない）
  var PREV = "hk-prev:" + GAME; // 控えに戻す途中だけ置く、戻す前の記録（版10）
  var NEXT = "hk-next:" + GAME; // 控えに戻す途中だけ置く、戻す先とちがういまの記録（戻す前に書く。版15）
  var PREVFP = "hk-prevfp:" + GAME; // 控えに戻す途中で止まったときの記録の印（そのあと記録が変わったかを見る。版11）
  var RACE = "hk-race:" + GAME + ":"; // 入れ替えと古いタブの保存が重なったときの印。後ろにその入れ替えの番号を付け、番号ごとに別のキーにする（古い印を消すときに新しい印を消さない。版13）
  var RACE_TEXT = "記録を入れ替えた直後に、別の画面が前の記録を保存しました。記録が混ざったかもしれません。もう一度取り込むか、「控えに戻す」で入れ替える前の記録に戻してください。";
  var MAX_JSON = 4 * 1024 * 1024; // localStorage はおおよそ 5MB まで
  var MAX_CODE = MAX_JSON * 2; // 貼りつけの長さの上限（HK0 の base64 でも MAX_JSON の 4/3 倍。URL・改行の分を足しても収まる）
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
  // 保存に失敗したままの記録のキー（この画面を開いているあいだだけ。読み直すとゲームの手元の記録も消えるので、それでよい）。
  // 失敗したあとは、ゲームの手元の記録だけが新しく、localStorage は古い。そのまま書き出すと古い記録が送られる（版7）
  var unsaved = {};
  function isLocal(s) { try { return s === localStorage; } catch (e) { return false; } }
  var mySync = ""; // このタブを開いたときの入れ替えの番号
  var reloading = false;
  function watchSaves() {
    mySync = syncNo();
    try {
      if (typeof Storage !== "function" || !Storage.prototype.setItem) return;
      var orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        // 別のタブで入れ替えたあとの古いタブは、手元の古い記録を書かずに読み直す（storage の知らせが届かなくても。版10）
        if (isLocal(this) && ours(String(k)) && syncNo() !== mySync) {
          staleTab();
          reloadIfSafe();
          return;
        }
        try { orig.call(this, k, v); } catch (e) {
          if (isLocal(this) && ours(String(k))) unsaved[String(k)] = 1;
          throw e; // ゲームには今までどおり失敗を返す
        }
        if (isLocal(this)) delete unsaved[String(k)];
        // 確かめてから書くまでのあいだに、別のタブが入れ替えた（タブをまたぐ鍵は無いので、書いたあとにもう一度見る。版13）。
        // 取り込んだ記録の一部を古い記録で上書きしたかもしれないので、印を残して知らせ、このタブは読み直す
        if (isLocal(this) && ours(String(k))) {
          var now = syncNo();
          if (now !== mySync) {
            // 印を書けない（端末の空きが無い）ときは読み直さず、このタブの帯で混ざったかもしれないと知らせ続ける（読み直すと、知らせがどこにも残らない）
            try { orig.call(this, RACE + now, "1"); } catch (e) { staleTab(RACE_TEXT); return; }
            staleTab();
            reloadIfSafe();
          }
        }
      };
    } catch (e) { /* 見張れないときは今までどおり */ }
  }
  function stale() { return Object.keys(unsaved).length > 0; }
  // 別のタブで入れ替えたあとに読み直す。保存に失敗したままの記録があるタブは、読み直すと手元の記録が消えるので読み直さず、帯で知らせる（版13、nenkin-shikumi #1 の CodeRabbit）
  function reloadIfSafe() {
    if (stale()) { staleTab(); return; }
    if (!reloading) { reloading = true; try { location.reload(); } catch (e) { reloading = false; /* 次の保存でまた読み直す（版11） */ } }
  }
  // 古いタブの保存を捨てたことを知らせる帯（読み直しが遅れる・止まると、そのあいだの保存はゲームには成功に見えて消える。版11）
  function staleTab(say) {
    try {
      var text = say || (stale()
        ? "別の画面で記録が入れ替わりました。この画面には保存できなかった記録があり、読み直すと消えます（この画面からはもう保存できません）。いまの点数などを控えてから読み直してください。"
        : "別の画面で記録が入れ替わったので、この画面の記録は保存できません。読み直してください。");
      var had = document.getElementById("hk-stale-tab");
      if (had) { if (had.firstChild && had.firstChild.nodeType === 3) had.firstChild.nodeValue = text; return; }
      var b = document.createElement("div");
      b.id = "hk-stale-tab";
      b.setAttribute("role", "alert");
      b.style.cssText = "position:fixed;left:8px;right:8px;top:8px;z-index:2147483001;background:#fff3cd;color:#3d2c00;border:2px solid #8a6d00;border-radius:10px;padding:10px 12px;font:15px/1.5 system-ui,-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif";
      b.appendChild(document.createTextNode(text));
      var r = document.createElement("button");
      r.type = "button";
      r.textContent = "読み直す";
      r.style.cssText = "display:block;margin-top:6px;min-height:44px;padding:0 16px;font:inherit;border-radius:8px;border:1px solid #8a6d00;background:#fff;color:#3d2c00";
      r.onclick = function () { location.reload(); };
      b.appendChild(r);
      (document.body || document.documentElement).appendChild(b);
    } catch (e) { /* なし */ }
  }
  // d に入れ替える。失敗したら元に戻す
  function replaceAll(d) {
    var old = snapshot();
    try {
      Object.keys(old).forEach(function (k) { localStorage.removeItem(k); });
      Object.keys(d).forEach(function (k) { localStorage.setItem(k, d[k]); });
    } catch (e) {
      var back = true;
      try {
        Object.keys(d).forEach(function (k) { localStorage.removeItem(k); });
        Object.keys(old).forEach(function (k) { localStorage.setItem(k, old[k]); });
      } catch (e2) { back = false; /* 元にも戻せなかった。控えを残して「控えに戻す」で戻してもらう */ }
      e.rolledBack = back;
      throw e;
    }
  }
  // d が配列のものは記録ではないので使わない（版12、dento-kogei #5 の CodeRabbit）
  function readKey(key) {
    try { var b = JSON.parse(localStorage.getItem(key) || "null"); return b && b.d && typeof b.d === "object" && !Array.isArray(b.d) ? b : null; } catch (e) { return null; }
  }
  // 控えに戻す途中で止まったときは、戻す前の記録（PREV）を控えとして出す（それがただ1つの写し。版10）
  // 両方あるときは新しいほう（止まったあとに別の記録を取り込んだら、その取り込みの前の記録へ戻す。版11、akushitsu-miyaburi #4 の CodeRabbit）
  // 戻す途中で止まって残った、戻す前のいまの記録（NEXT）も同じく出す（版15）
  function readBackup() {
    var best = null, bt = -1;
    [readKey(PREV), readKey(BACKUP), readKey(NEXT)].forEach(function (b) {
      if (!b) return;
      var t = Date.parse(b.at) || 0;
      if (t > bt) { best = b; bt = t; }
    });
    return best;
  }
  function syncNo() { try { return localStorage.getItem(SYNC) || ""; } catch (e) { return ""; } }
  // 記録の印（キーの順によらない）。途中で止まったあとに記録が変わったかを見る（版11）
  function fp(d) {
    var k = Object.keys(d).sort();
    var t = JSON.stringify(k.map(function (x) { return [x, d[x]]; }));
    try { return crc32(new TextEncoder().encode(t)) + "." + t.length; } catch (e) { return String(t.length) + "." + t.slice(0, 64); }
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
  function encode(d, plain) {
    if (stale()) return Promise.reject(fail("unsaved"));
    if (!count(d)) return Promise.reject(fail("empty")); // 記録が無いコードは、受け取る側で必ず弾かれるので作らない
    var json = JSON.stringify({ g: GAME, v: VERSION, at: new Date().toISOString(), d: d });
    var raw = new TextEncoder().encode(json);
    // 受け取る側が弾く大きさのコードは作らない（書き出しは成功したのに取り込めない、をなくす）
    if (raw.length > MAX_JSON) return Promise.reject(fail("big"));
    var z;
    try { z = plain ? null : new CompressionStream("deflate-raw"); } catch (e) { z = null; } // plain：縮めない HK0（版7）
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
    // URL の途中で改行されていても（改行のあとの字下げも）、コードに使う文字が続くあいだは1つのコードとして取る
    // 行の中の空白で切れていても（メールやチャットの折り返し）、つなげて CRC が合うところを使う（版7）
    var m = s.match(/[#&]hk=([A-Za-z0-9_.%-]+(?:\s+[A-Za-z0-9_.%-]+)*)/);
    var src = m ? m[1] : s;
    var un = function (x) { if (!m) return x; try { return decodeURIComponent(x); } catch (e) { return x; } };
    // 行をつなぐと、コードのあとの行（「  Note: keep」など）の字まで入ることがある。
    // 長いほうから順に、終わりの3行までを外して CRC が合うところを使う（合わなければ全部つないで、写しまちがいとして知らせる。
    // 外すのを3行までにするのは、とても長いコードで CRC を何度も計り直さないため。版6）
    // 区切りは改行と空白（版7。前は改行だけ）。外すのは終わりの8つまで
    var lines = src.split(/\s+/).filter(Boolean);
    // URL でなく貼られたときは、HK で始まる語から読む（「コード: HK1....」のように前に言葉があっても。版10）
    if (!m) { for (var h = 0; h < lines.length; h++) if (/^HK[01]\./.test(lines[h])) { lines = lines.slice(h); break; } }
    // つなぐのは1回だけ。外す候補は長さで切り出す（とても長い貼りつけを何度も写さない。版10）
    var full = lines.join(""), ends = [], at = 0;
    for (var i = 0; i < lines.length; i++) { at += lines[i].length; ends.push(at); }
    var tried = {};
    var tryK = function (k) {
      if (k < 1 || k > lines.length || tried[k]) return null;
      tried[k] = 1;
      var c = un(full.slice(0, ends[k - 1]));
      return whole(c) ? c : null;
    };
    // 長いほうから終わりの8語まで、そのあと先頭の1語（コードの後ろに言葉が9語以上続くとき。版10）
    for (var k = lines.length; k >= 1 && k >= lines.length - 8; k--) { var got = tryK(k); if (got) return got; }
    var one = tryK(1); if (one) return one;
    return un(full).replace(/\s+/g, "");
  }
  // 形と CRC が合う、ひとそろいのコードか
  function whole(c) {
    if (c.length > MAX_CODE) return false; // 長すぎるものは CRC を計らない（版7）
    var m = c.match(/^HK([01])\.([A-Za-z0-9_-]+)\.([0-9a-z]{1,7})$/);
    if (!m) return false;
    // HK0 は戻す前に、戻した大きさが MAX_JSON を超えないかを見る（分けて貼られると最大9回戻すため。版9）
    if (m[1] === "0" && Math.floor(m[2].length * 3 / 4) > MAX_JSON) return false;
    try { return crc32(unb64(m[2])) === m[3]; } catch (e) { return false; }
  }
  var ERR = {
    form: "コードの形がちがいます。最後まで写せているか確かめてください。",
    crc: "コードが途中で変わっています（写しまちがい・欠け）。もう一度写してください。",
    old: "このブラウザでは読めないコードです。ブラウザを新しくするか、書き出した端末でもう一度作ってください。",
    game: "別のゲームのコードです。",
    keys: "このゲームの記録ではない中身が入っています。",
    bad: "記録に使わない文字が入っています。書き出した端末でもう一度作ってください。",
    big: "記録が大きすぎます。",
    empty: "まだ記録がありません。",
    newer: "新しい版の引き継ぎコードです。ページを読み直して（アプリを開き直して）から試してください。",
    unsavedSwap: "この端末で、最新の記録を保存できていません（空きが足りないかもしれません）。いま入れ替えると、その記録が消えます。端末の空きを作ってから、もう一度遊んで保存してください。",
    unsaved: "この端末で、最新の記録を保存できていません（空きが足りないかもしれません）。このままでは古い記録を送ってしまうので、コードを作りません。端末の空きを作ってから、もう一度遊んで保存してください。",
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
    // deflate-raw を知らない古いブラウザは、ここで作れずに投げる（形のまちがいでなく「古い」と知らせる。版4）
    var ds;
    try { ds = new DecompressionStream("deflate-raw"); } catch (e) { throw fail("old"); }
    var reader = new Blob([bytes]).stream().pipeThrough(ds).getReader();
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
      // 貼られたままの長さを先に見る（とても長い文字で、CRC・広げる・行のつなぎ直しを何度も回してタブを固めない。版7）
      if (String(text || "").length > MAX_CODE) throw fail("big");
      var s = clean(text);
      if (s.length > MAX_JSON * 2) throw fail("big");
      var m = s.match(/^HK([01])\.([A-Za-z0-9_-]+)\.([0-9a-z]{1,7})$/);
      if (!m) throw fail("form");
      // HK0 は中身がそのまま base64。戻す前に、戻した大きさ（4 文字で 3 バイト）が MAX_JSON を超えないかを見る（版8）
      if (m[1] === "0" && Math.floor(m[2].length * 3 / 4) > MAX_JSON) throw fail("big");
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
    var msg, partial = false, undo = false;
    try {
      var job = JSON.parse(p);
      // いまの data-keys の外のキー（前の版の控えに入っていた a11y-v1 など）は書かない
      var d = {};
      Object.keys(job.d || {}).forEach(function (k) { if (ours(k) && typeof job.d[k] === "string") d[k] = job.d[k]; });
      // 全部が外のキーだった（中身が空になった）ときは、いまの記録を消さないよう入れ替えない
      if (!count(d) && count(job.d || {})) throw new Error("data-keys の外のキーだけ");
      job.d = d;
      var oldSync = localStorage.getItem(SYNC); // 入れ替えに失敗したら戻す（版11）
      var swapped = false;
      // 入れ替える前に番号を進める。前の番号で開いたタブは、ここから先ゲームの保存を書かない（watchSaves）。
      // 書けなければ入れ替えない（古いタブが、取り込んだ記録を手元の古い記録で上書きしうる。版10、#252 の CodeRabbit）
      // 書き換えの前は「.w」、終わったら同じ長さの「.d」にする（書き換えの途中で開いたタブは .w を持つので、終わったあとは古いタブになる。版15）
      var syncBase = String(Date.now()) + "." + (Math.random().toString(36) + "00000000").slice(2, 10);
      var mySync = syncBase + ".w";
      localStorage.setItem(SYNC, mySync);
      // 控えにする記録は、番号を進めて古いタブの保存を止めてから読む（前に読むと、そのあいだの保存が控えに入らずに消える。版13、hatsuden-kurabe #1 の CodeRabbit）
      var cur = snapshot();
      if (job.undo) {
        // 控えに戻す：控え（job.d と同じ中身）は入れ替えが済むまで上書きしない。途中で止まっても、もう一度「控えに戻す」で戻せる（版5）
        // 先に、戻す前の記録を PREV に書く。書けなければ戻さない（入れ替えも元に戻すのも失敗すると、いまの記録がどこにも残らない。版10）
        // 前に途中で止まって PREV が残っていれば、それが元の記録のただ1つの写しなので上書きしない（#252 の CodeRabbit）
        var held = localStorage.getItem(PREV);
        // 壊れた値（JSON として読めない・形がちがう）は使わない。控えにすると、いまの記録がどこにも残らない（版11）
        if (held != null && !readKey(PREV)) held = null;
        var stamp = held != null ? held : JSON.stringify({ at: new Date().toISOString(), d: cur });
        // 新しい PREV を書く前に、前の止まったときの印（PREVFP）を消す（古い印が残ると、次に止まったとき、そのあとの記録を「変わっていない」と見て控えに残さない。版11）
        if (held == null) { localStorage.removeItem(PREVFP); localStorage.setItem(PREV, stamp); }
        var heldB = held != null ? readKey(PREV) : null;
        var same = function (a, b) { var k = Object.keys(a).sort(); return JSON.stringify(k) === JSON.stringify(Object.keys(b).sort()) && k.every(function (x) { return a[x] === b[x]; }); };
        var toHeld = !!heldB && same(heldB.d, job.d); // 残っていた PREV（元の記録）へ戻す
        // 止まったあとに記録が変わっていたら（あとから遊んだ分がある）、戻すときにいまの記録を控えにする（版11）
        var moved = false;
        // 印が無い（止まったときに書けなかった）ときは、変わったかわからないので、控え（元の記録のただ1つの写しかもしれない）を上書きしない（版11）
        if (toHeld) { var was = null; try { was = localStorage.getItem(PREVFP); } catch (e) { /* なし */ } moved = was != null && was !== fp(cur); }
        // 残った記録とはちがう控え（そのあと取り込んだ記録の控え）へ戻すときも、いまの記録を控えにする（版11）
        var mine = moved || (heldB && !toHeld) ? JSON.stringify({ at: new Date().toISOString(), d: cur }) : stamp;
        // いまの記録（mine）を控えにするなら、戻す前に NEXT に書く。書けなければ戻さない
        // （戻したあと控えを書けず、元にも戻せないと、いまの記録がメモリにしか無く消える。版15、kawagoe-1day #1 の CodeRabbit）
        // 印が無く（止まったときに書けなかった）控えを上書きしない回も、いまの記録はあとから遊んだ分かもしれないので NEXT に残す（控えにはしない）
        var unsure = toHeld && !moved && was == null && !same(cur, job.d);
        var wroteNext = false;
        if (mine !== stamp || unsure) {
          var nextB = readKey(NEXT);
          if (!nextB || same(nextB.d, cur)) {
            if (!nextB) { localStorage.setItem(NEXT, JSON.stringify({ at: new Date().toISOString(), d: cur })); wroteNext = true; }
          } else {
            // 前に途中で止まって残った NEXT は、それがただ1つの写しかもしれないので上書きしない。
            // NEXT へ戻すところで、いまの記録が止まったときのまま（遊んでいない）なら、いまの記録は残さなくてよい
            var wasN = null; try { wasN = localStorage.getItem(PREVFP); } catch (e) { /* なし */ }
            if (!(same(nextB.d, job.d) && wasN != null && wasN === fp(cur))) throw new Error("hk-next が残っている");
          }
        }
        var dropNext = function () { if (wroteNext) { try { localStorage.removeItem(NEXT); } catch (e) { /* なし */ } } };
        try { replaceAll(job.d); } catch (e) {
          partial = e.rolledBack === false;
          if (!partial) dropNext();
          if (!partial && held == null) { try { localStorage.removeItem(PREV); } catch (e2) { /* なし */ } }
          // 途中で止まったときの記録の印を残す（そのあと記録が変わったら、戻すときにその記録を控えにする。版11）
          if (partial) { try { localStorage.setItem(PREVFP, fp(snapshot())); } catch (e3) { /* なし */ } }
          if (partial) swapped = true;
          throw e;
        }
        swapped = true;
        if (!toHeld || moved) {
          // 済んだら、戻す前の記録を控えにする（もう一度押すと戻る）。控えを書けなければ入れ替えを戻す。
          // 戻すのも失敗したら PREV を残す（readBackup が控えとして出す）。戻す前が空でも、空の記録を控えにする（版8）
          try { localStorage.setItem(BACKUP, mine); } catch (e) {
            try { replaceAll(cur); } catch (e2) {
              partial = true;
              // ここでも止まったときの記録の印を残す（無いと、あとで遊んだ分を「変わっていない」と見て控えに残さない。版13、hatsuden-kurabe #1 の CodeRabbit）
              try { localStorage.setItem(PREVFP, fp(snapshot())); } catch (e3) { /* なし */ }
              throw e2;
            }
            swapped = false;
            dropNext();
            if (held == null) { try { localStorage.removeItem(PREV); } catch (e3) { /* なし */ } }
            throw e;
          }
        }
        // 前に止まって残った NEXT は、戻した記録か控えと同じときだけ消す。ちがえば残す（ただ1つの写しかもしれない。readBackup が控えとして出す。版15）
        var nx = readKey(NEXT), bk = readKey(BACKUP);
        var nextDone = !nx || same(nx.d, job.d) || (!!bk && same(nx.d, bk.d));
        try { localStorage.removeItem(PREV); localStorage.removeItem(PREVFP); if (nextDone) localStorage.removeItem(NEXT); } catch (e) { /* なし */ }
      } else {
        // 先にいまの記録を控えに残す（空なら控えは作らない。前の控えも消さない）。控えを書けなければ入れ替えない
        var prev = localStorage.getItem(BACKUP);
        if (count(cur)) localStorage.setItem(BACKUP, JSON.stringify({ at: new Date().toISOString(), d: cur }));
        try { replaceAll(job.d); } catch (e) {
          // 元に戻せなかったときは、いまの記録の控えを消さない（それが前の記録のただ1つの写し）
          if (e.rolledBack === false) { partial = true; swapped = true; throw e; }
          try { if (prev == null) localStorage.removeItem(BACKUP); else localStorage.setItem(BACKUP, prev); } catch (e2) { /* なし */ }
          throw e;
        }
        swapped = true;
      }
      msg = job.undo ? "取り込む前の記録に戻しました" : "記録を引き継ぎました";
      // ほかのタブへの知らせは、上で進めた番号の storage イベント（古いタブは読み直す。版7）
      undo = !job.undo && count(cur) > 0;
    } catch (e) {
      undo = partial;
      // 記録が変わらなかったときは、進めた番号を戻す（ほかのタブの保存を捨てさせない。版11）
      // ほかのタブがそのあと番号を進めていたら、戻さない（戻すと、そのタブの入れ替えの前に開いた古いタブが保存できてしまう。版11）
      if (!swapped && typeof oldSync !== "undefined" && typeof mySync !== "undefined") { try { if (localStorage.getItem(SYNC) === mySync) { if (oldSync == null) localStorage.removeItem(SYNC); else localStorage.setItem(SYNC, oldSync); } } catch (e4) { /* なし */ } }
      msg = partial ? "途中で止まりました（端末の空きが足りないかもしれません）。「引き継ぎ」の「控えに戻す」で前の記録に戻せます" : "引き継げませんでした（端末の空きが足りないかもしれません）。記録は元のままです";
    }
    // 記録を（途中までも）書き換えたら、番号を書き換え終わりの印（.d）にする。書き換えの途中で開いたタブ（.w を持ち、古い記録を読んだかもしれない）は、
    // ここから先は古いタブとして保存を書かずに読み直す（版15、kawagoe-1day #1 の CodeRabbit）。同じ長さの値なので、空きが無くても書ける見込みが高い
    if (typeof swapped !== "undefined" && swapped && typeof syncBase !== "undefined") {
      try { if (localStorage.getItem(SYNC) === syncBase + ".w") localStorage.setItem(SYNC, syncBase + ".d"); } catch (e) { msg += "。ほかの画面でこのゲームを開いていたら、読み直してから遊んでください"; }
    }
    // u：知らせに「控えに戻す」を付ける（取り込んだ記録の形でゲームが動かなくても、ここから戻せるように。版4）
    try { sessionStorage.setItem(DONE, JSON.stringify({ m: msg, u: undo })); } catch (e) { /* なし */ }
  })();
  watchSaves(); // 入れ替え（上）の書き込みは数えない。ここから先のゲームの保存を見張る

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
    ".hk-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483001;background:#222;color:#fff;padding:12px 18px;border-radius:12px;font:14px/1.5 system-ui,sans-serif;max-width:calc(100% - 32px);box-sizing:border-box}",
    ".hk-toast .hk-row{margin-top:6px}",
    ".hk-toast button{min-height:44px;min-width:44px;padding:8px 14px;border-radius:10px;border:1px solid #888;background:transparent;color:#fff;font:inherit;cursor:pointer}",
    ".hk-toast button:focus-visible{outline:3px solid #5b9cff;outline-offset:2px}",
  ].join("\n");
  var back = null, lastFocus = null, req = 0, onClosed = null;
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
  // withUndo のときは自分では消えず、「控えに戻す」「閉じる」を出す（ゲームの画面が出なくても戻せるように）
  function toast(text, withUndo) {
    style();
    var t = el("div", { class: "hk-toast", role: "status" }, [el("div", { text: text })]);
    function gone() { if (t.parentNode) t.parentNode.removeChild(t); }
    var b = withUndo ? readBackup() : null;
    if (b) {
      t.appendChild(el("div", { class: "hk-row" }, [
        // やめたら知らせを出し直す（ゲームの画面が出ず data-hk も無いと、ほかに戻す入口が無い。版6）
        btn("控えに戻す", function () { gone(); confirmUndo(b, function () { toast(text, true); }); }, false, "hk-toast-undo"),
        btn("閉じる", gone, false, "hk-toast-close"),
      ]));
    } else setTimeout(gone, 4000);
    document.body.appendChild(t);
  }
  function close() {
    req++; // 読み取り中のコードの結果は、閉じたあとに画面へ出さない
    if (!back) return;
    back.parentNode.removeChild(back);
    back = null;
    var after = onClosed; onClosed = null; // 箱を閉じたあとにすること（知らせの出し直しなど）
    if (after) after();
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
    req++; // 画面を替えたら、読み取り中のコードの結果は出さない
    onClosed = null;
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
  // QR の部品（transfer-qr.js）を、はじめて要るときに1回だけ読む。読めなければ QR は出さない（コードで渡せる）
  var QR_SRC = me && me.src ? me.src.replace(/transfer\.js(?:[?#].*)?$/, "transfer-qr.js") : "transfer-qr.js";
  var qrWait = null;
  function loadQr() {
    if (window.HKQR) return Promise.resolve();
    if (qrWait) return qrWait;
    qrWait = new Promise(function (ok, ng) {
      var sc = document.createElement("script");
      sc.src = QR_SRC; sc.async = true;
      sc.onload = function () { if (window.HKQR) ok(); else { qrWait = null; ng(new Error("qr")); } };
      sc.onerror = function () { qrWait = null; sc.remove(); ng(new Error("qr")); };
      (document.head || document.documentElement).appendChild(sc);
    });
    return qrWait;
  }
  function qrSvg(text) {
    var q = window.HKQR(0, "L");
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
      if (b.isConnected) { try { b.focus(); } catch (e) { /* なし */ } } // 選ぶために動いた操作の場所を、押したボタンに戻す（版7）。箱を閉じたあとは戻さない（版10）
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
    // 貼る欄に書いたら、読み取り中のファイルの中身で上書きしない（版6）
    paste.addEventListener("input", function () { req++; });
    var fileIn = el("input", { type: "file", accept: ".txt,text/plain" });
    fileIn.addEventListener("change", function () {
      // 選び直したら、どの道でも先に番号を進める（前のファイルの読み取り結果で、いまのエラーを隠さない）
      var my = ++req;
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      if (f.size > MAX_JSON * 2) { err.textContent = ERR.big; err.hidden = false; return; }
      f.text().then(function (t) { if (my !== req) return; paste.value = t; tryImport(); }, function () { if (my !== req) return; err.textContent = ERR.form; err.hidden = false; });
    });
    function tryImport() {
      err.hidden = true;
      var my = ++req; // 後から押したほうだけを使う（古い結果で上書きしない）
      decode(paste.value).then(function (r) { if (my === req) confirmImport(r); }, function (e) { if (my !== req) return; err.textContent = e.kind ? e.message : ERR.form; err.hidden = false; });
    }
    var sendPart = [el("h3", { text: "この端末の記録を送る" })];
    if (stale()) sendPart.push(el("p", { class: "hk-err", role: "alert", id: "hk-stale", text: ERR.unsaved }));
    else if (!count(d)) sendPart.push(el("p", { text: "まだ記録がありません。" }));
    else {
      var qr = el("div", { class: "hk-qr", id: "hk-qr" });
      var out = el("textarea", { id: "hk-code", readonly: "", "aria-label": "引き継ぎコード" });
      var note = el("p", { text: "新しい端末のカメラで QR を読むと、このゲームが開いて取り込めます。" });
      var copyBtn = btn("コピー", function () { copy(url(out.value), copyBtn); });
      var saveBtn = btn("ファイルに保存", function () { save(out.value); });
      // 受け取る端末のブラウザが古く「読めない」と出たときに、縮めないコード（HK0）を作り直す（版7）
      var plainBtn = btn("古いブラウザ向けに作り直す", function () { make(true); }, false, "hk-plain");
      var plainNote = el("p", { text: "受け取る側で「このブラウザでは読めない」と出たら、下のボタンで作り直してください（コードが長くなります）。" });
      sendPart.push(qr, note, out, el("div", { class: "hk-row" }, [copyBtn, saveBtn]), plainNote, el("div", { class: "hk-row" }, [plainBtn]));
      var gen = 0; // 作り直しを続けて押したときは、後のほうだけを出す
      var make = function (plain) {
        var my = ++gen;
        copyBtn.disabled = saveBtn.disabled = plainBtn.disabled = true;
        d = snapshot(); // 開いたあとに遊んだ分も入れる（版10）
        encode(d, plain).then(function (code) {
          if (my !== gen) return;
          if (stale()) throw fail("unsaved"); // 縮めているあいだに保存が失敗した（版10）
          out.value = code;
          copyBtn.disabled = saveBtn.disabled = false;
          plainBtn.disabled = /^HK0/.test(code); // もう縮めていない
          if (plain) { plainNote.textContent = "縮めないコードにしました。"; }
          var u = url(code);
          qr.hidden = false; qr.innerHTML = "";
          if (u.length <= QR_MAX) {
            loadQr().then(function () { if (my !== gen) return; try { qr.innerHTML = qrSvg(u); } catch (e) { qr.hidden = true; } },
              function () { if (my !== gen) return; qr.hidden = true; note.textContent = "QR を出せませんでした（電波が無いときなど）。コードをコピーするか、ファイルで送ってください。"; });
          }
          else { qr.hidden = true; note.textContent = "記録が多いので QR に入りません。コードをコピーするか、ファイルで送ってください。"; }
        }).catch(function (e) { if (my !== gen) return; out.value = ""; qr.hidden = true; note.textContent = e && e.kind === "big" ? "記録が大きすぎて、コードにできません。" : e && e.kind === "unsaved" ? ERR.unsaved : "コードを作れませんでした。"; });
      };
    }
    var getPart = [
      el("h3", { text: "記録を受け取る" }),
      el("p", { text: "ホーム画面に置いたアプリで遊ぶときは、そのアプリの中でここにコードを貼ります（iPhone はブラウザとアプリで記録が別です）。" }),
      paste, err,
      el("div", { class: "hk-row" }, [btn("取り込む", tryImport, true, "hk-go"), el("label", { class: "hk-file" }, [document.createTextNode("ファイルを開く"), fileIn])]),
    ];
    var b = readBackup();
    var undoPart = b ? [el("h3", { text: "取り込む前に戻す" }), el("p", { text: when(new Date(b.at)).replace("に作った", "の控え") + (count(b.d) ? "があります。" : "（記録が無い状態）があります。") }),
      el("div", { class: "hk-row" }, [btn("控えに戻す", function () { confirmUndo(b); }, false, "hk-undo")])] : [];
    show([el("h2", { id: "hk-title", text: "引き継ぎ" })].concat(sendPart, getPart, undoPart, [el("div", { class: "hk-row" }, [btn("閉じる", close, false, "hk-close")])]),
      count(d) ? "#hk-close" : "#hk-in");
    if (make) make(false);
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
        btn("入れ替える", function () { if (stale()) { err.textContent = ERR.unsavedSwap; err.hidden = false; return; } if (!commit(r.d)) { err.textContent = "取り込めませんでした（ブラウザの設定で保存が止められているかもしれません）。"; err.hidden = false; } }, true, "hk-yes"),
        btn("やめる", close, false, "hk-no"),
      ]),
    ], "#hk-no");
  }
  function confirmUndo(b, onCancel) {
    var err = el("p", { class: "hk-err", role: "alert", hidden: "" });
    show([
      el("h2", { id: "hk-title", text: "控えに戻しますか？" }),
      el("p", { text: "今の記録と、" + when(new Date(b.at)).replace("に作った", "の控え") + "を入れ替えます。もう一度押せば、また入れ替わります。" }),
      err,
      el("div", { class: "hk-row" }, [btn("戻す", function () { if (stale()) { err.textContent = ERR.unsavedSwap; err.hidden = false; return; } if (!commit(b.d, true)) { err.textContent = "戻せませんでした（ブラウザの設定で保存が止められているかもしれません）。"; err.hidden = false; } }, true, "hk-yes"), btn("やめる", close, false, "hk-no")]),
    ], "#hk-no");
    onClosed = onCancel || null; // やめる・Esc・外を押す、のどれで閉じても
  }

  // 入れ替えと古いタブの保存が重なったら知らせる（いまの入れ替えの番号の印だけ。版13）
  // 前の入れ替えの印は、いまの番号より古い（番号の頭の時刻が小さい）ものだけ黙って消す（読んだあとに書かれた新しい印は消さない）
  function raced() {
    var cur = syncNo(), mine = RACE + cur, has = false, old = [];
    var tOf = function (n) { return parseFloat(String(n).split(".")[0]) || 0; };
    try {
      has = localStorage.getItem(mine) != null;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(RACE) === 0 && k !== mine && tOf(k.slice(RACE.length)) < tOf(cur)) old.push(k);
      }
    } catch (e) { return; }
    old.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* なし */ } });
    if (!has) return;
    try { localStorage.removeItem(mine); } catch (e) { /* なし */ }
    toast(RACE_TEXT, true);
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
    if (msg) {
      var o = null;
      try { o = JSON.parse(msg); } catch (e) { /* 前の版の知らせ（ただの文字） */ }
      if (o && typeof o.m === "string") toast(o.m, !!o.u); else toast(msg);
    }
    checkHash();
    window.addEventListener("hashchange", checkHash);
    // 別のタブで記録を入れ替えたら、このタブも読み直す（手元に残った古い記録で、取り込んだ記録を上書きしない。版7）
    // 保存に失敗したままの記録があるタブは読み直さず、帯で知らせる（版13）
    window.addEventListener("storage", function (e) {
      if (e.key === SYNC && e.newValue) { if (stale()) staleTab(); else location.reload(); }
      if (e.key === RACE + syncNo() && e.newValue) raced();
    });
    raced();
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

  window.HK = { open: open, encode: function (plain) { return encode(snapshot(), plain); }, decode: decode, version: VERSION };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

})();
