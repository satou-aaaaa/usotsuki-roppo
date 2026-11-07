// 見やすさ・読みやすさ・偏りの検査（どのゲームも同じ。shared-workflows template/qa/a11y.mjs の写し。ここでは直さず、ひな形を直して写す）。
// 使い方: node qa/a11y.mjs   （qa/run.mjs の最後からも呼ぶ。失敗があれば終了コード 1。結果は qa-report/a11y.md と色覚の見え方の絵）
// 見ること（出典は shared-workflows routines/game-dev.md「だれでも遊べるように」）:
//   1. 見やすさの設定（template/a11y/a11y.html）がひな形と同じ中身で入り、開くボタンがホームに見えている
//   2. lang="ja"・拡大を禁じない（WCAG 1.4.4）
//   3. 文字のコントラスト 4.5:1（大きい字は 3:1）。ふつう・全部の設定を入れたときの両方（WCAG 1.4.3）
//   4. 字間・行間を広げても横にはみ出さない・字が切れない（WCAG 1.4.12・1.4.10。幅320px）
//   5. 動きを減らす設定（端末の「視差効果を減らす」）で、動き続けるアニメーションが無い（WCAG 2.3.3）
//   6. キーボード（Tab）で選んだ所に枠が見える（WCAG 2.4.7）・名前の無いボタンや絵が無い（WCAG 4.1.2・1.1.1）
//   7. 知らせを読み上げソフトに伝える場所（aria-live / role=status）がある（WCAG 4.1.3）
//   8. 斜体の日本語が無い（BDA Dyslexia Style Guide）
//   12. 操作のあとも設定の印が html に残る・各画面に読み上げる文（data-a11y-say）がある
//   9. 役割や性別を決めつける言葉が無い（words は下の WORDS。ユネスコの教材のジェンダー指針）
//  11. はじめに読むファイル（index.html と同じサイトの script）が 1.5MB 以下（遅い回線・古い端末。game-dev.md A12）
//  10. 色覚（P型・D型・T型）の見え方の絵を qa-report/ に出す（人と AI が目で見る。色だけで分けていないかは各ゲームの qa/run.mjs が見る）
// ゲームごとの許し・追加の画面は qa/a11y.json（無くてよい）:
//   { "screens": [{ "name": "遊ぶ画面", "click": ["#go-d"] }],          // ホームのほかに測る画面（順に押す）
//     "skipContrast": [{ "selector": ".ticket-num", "reason": "…" }],  // 理由の無い許しは置かない
//     "allowWords": [{ "word": "主人", "reason": "店の主（あるじ）の意味" }],
//     "noSay": [{ "screen": "実績", "reason": "…" }] }                     // 読み上げる文が要らない画面（理由つき）
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfgPath = path.join(root, "qa", "a11y.json");
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: String(detail).slice(0, 600) });
for (const k of ["skipContrast", "allowWords", "noSay"]) for (const a of cfg[k] || []) if (!a.reason) { console.error(`qa/a11y.json の ${k} に reason の無い行がある（理由の無い許しは置かない）`); process.exit(2); }

const html = readFileSync(path.join(root, "index.html"), "utf8");
// 1. 設定の部品がひな形と同じか（ひな形が手元にあれば中身まで。CI では印と版を見る）
const block = (t) => (t.match(/<!-- a11y:begin[\s\S]*?<!-- a11y:end -->/) || [""])[0];
const mine = block(html);
const tplPath = process.env.A11Y_TEMPLATE || path.join(root, "..", "shared-workflows", "template", "a11y", "a11y.html");
const tpl = existsSync(tplPath) ? block(readFileSync(tplPath, "utf8")) : "";
check("見やすさの設定（shared-workflows template/a11y/a11y.html）が入っている", mine && /window\.A11y/.test(mine) && /<\/head>/.test(html.slice(html.indexOf("a11y:end"))));
if (tpl) check("見やすさの設定がひな形と同じ中身（直すのはひな形。写しを直さない）", mine === tpl, mine === tpl ? "" : "ひな形からもう一度写す");

// 1 の続き：ゲームが html の class を丸ごと書き換えると、設定の印（a11y-read など）が消える（2026-11-05 おつかいメモ。incidents/2026-11-05-a11y-class-and-say-gaps.md）
{ const body = html.replace(/<!-- a11y:begin[\s\S]*?<!-- a11y:end -->/, "");
  const hit = body.match(/(documentElement|\bhtml|\broot)\.className\s*=(?!=)[^;\n]{0,60}/g) || [];
  check("html の class を丸ごと書き換えない（classList.add/remove/toggle を使う。設定の印が消える）", hit.length === 0, hit.join(" / ")); }

// 2. lang・拡大
const vp = (html.match(/<meta name="viewport" content="([^"]+)"/) || [])[1] || "";
check('<html lang="ja"> がある（読み上げが日本語で読む）', /<html[^>]*\blang="ja"/.test(html));
check("拡大を禁じない（user-scalable=no・maximum-scale を付けない。WCAG 1.4.4）", vp && !/user-scalable\s*=\s*(no|0)/.test(vp) && !/maximum-scale\s*=\s*(1(\.0)?|0\.\d+)\b/.test(vp), vp);

// 9. 言葉（index.html と、そばの .js・.json のデータ。条文の引用は対象外にしたいときは allowWords に理由を書く）
const WORDS = [
  ["女子力", "（言いかえる：気配り・身だしなみ など中身で）"], ["男らしい", "（言いかえる：頼もしい・勇ましい）"], ["女らしい", "（言いかえる：中身で）"],
  ["男のくせに", ""], ["女のくせに", ""], ["女々しい", "（言いかえる：未練がましい）"], ["男勝り", ""], ["紅一点", ""],
  ["看護婦", "→ 看護師"], ["保母", "→ 保育士"], ["保父", "→ 保育士"], ["婦警", "→ 警察官"], ["スチュワーデス", "→ 客室乗務員"], ["女医", "→ 医師"],
  ["女流", ""], ["女社長", "→ 社長"], ["女子アナ", "→ アナウンサー"], ["父兄", "→ 保護者"], ["ビジネスマン", "→ 会社員・ビジネスパーソン"],
  ["サラリーマン", "→ 会社員"], ["キーマン", "→ キーパーソン"], ["カメラマン", "→ 撮影者"], ["OL", "→ 会社員"], ["主婦", "→ 家事をする人（性別を決めない）"],
  ["奥さん", "→ 配偶者・パートナー"], ["奥様", "→ 配偶者"], ["嫁", "→ 配偶者"], ["家内", "→ 配偶者"], ["亭主", "→ 配偶者"], ["ご主人", "→ 配偶者（店の主なら allowWords に理由）"],
  ["女の子なのに", ""], ["男の子なのに", ""], ["女性ならでは", ""], ["男性ならでは", ""], ["ママの味", "→ 家庭の味"], ["おふくろの味", "→ 家庭の味"],
];
const allow = new Set((cfg.allowWords || []).map((a) => a.word));
const textFiles = readdirSync(root).filter((f) => /\.(html|js|json)$/.test(f) && f !== "package-lock.json" && f !== "classic.html");
const hits = [];
for (const f of textFiles) {
  const t = readFileSync(path.join(root, f), "utf8").replace(/<!-- a11y:begin[\s\S]*?<!-- a11y:end -->/, "");
  for (const [w, hint] of WORDS) {
    if (allow.has(w)) continue;
    const re = w === "OL" ? /(?<![A-Za-z])OL(?![A-Za-z])/ : new RegExp(w);
    if (re.test(t)) hits.push(`${f}:「${w}」${hint}`);
  }
}
check("役割・性別を決めつける言葉が無い（ユネスコの教材のジェンダー指針。言いかえは shared-workflows routines/game-dev.md）", hits.length === 0, hits.join(" / "));

// 11. 重さ（index.html と、そこから読む同じサイトの script の合計）
{
  const srcs = [...html.matchAll(/<script[^>]*\bsrc="(?!https?:|\/\/)([^"?#]+)/g)].map((m) => m[1]);
  const size = [html, ...srcs.filter((s) => existsSync(path.join(root, s))).map((s) => readFileSync(path.join(root, s)))].reduce((a, b) => a + Buffer.byteLength(b), 0);
  check("はじめに読むファイルが 1.5MB 以下（遅い回線・古い端末でも開ける。game-dev.md A12）", size <= 1.5 * 1024 * 1024, `${Math.round(size / 1024)}KB`);
}

// ブラウザで見る
const { chromium } = await import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const url = pathToFileURL(path.join(root, "index.html")).href;
const out = path.join(root, "qa-report");
mkdirSync(out, { recursive: true });
const skipSel = (cfg.skipContrast || []).map((s) => s.selector).join(",");
const screens = [{ name: "ホーム", click: [] }, ...(cfg.screens || [])];
const ALL_ON = { read: true, cvd: true, calm: true, say: true, ruby: true };

async function openPage({ width = 390, settings = null, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: reduced ? "reduce" : "no-preference" });
  if (settings) await ctx.addInitScript((s) => { try { localStorage.setItem("a11y-v1", JSON.stringify(s)); } catch { /* 無い */ } }, settings);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
// はじめての人向けの説明（dialog）などを閉じる。説明そのものは「ホーム」で測る
const dismiss = (page) => page.evaluate(() => { for (const d of document.querySelectorAll("dialog[open]:not(.a11y-dlg)")) d.close ? d.close() : d.removeAttribute("open"); });
async function go(page, sc) {
  if ((sc.click || []).length) await dismiss(page);
  for (const sel of sc.click || []) { await page.click(sel, { timeout: 3000 }); await page.waitForTimeout(300); }
  await page.waitForTimeout(700); // 出てくる動きが終わるのを待つ
}

// 3. コントラスト（字のある要素ごとに、字の色とうしろの色を重ねて比べる。うしろが絵・グラデーションのときは測れないので数えない。html・body の地の模様は地の色で測る）
const contrastFn = (skip) => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const bad = [];
  let measured = 0, skipped = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("svg,canvas,[aria-hidden=true],[hidden],dialog:not([open])") || (skip && el.closest(skip))) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && /[^\s\p{Emoji_Presentation}\p{Extended_Pictographic}‍️★☆・…、。]/u.test(n.textContent));
    if (!own) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || +cs.opacity === 0) continue;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue; // 押せない部品は WCAG の対象外
    let fg = parse(cs.color); if (!fg) continue;
    // うしろの色：自分から上へ、色を重ねていく。絵・グラデーションがあれば測らない
    // opacity は、その要素の中身（背景も子も字も）をまとめて描いてから薄くする（CSS Color 4「opacity」）。
    // 字の色・うしろの色のそれぞれを、内側から「その層の背景の上に重ね、その層の opacity で薄くする」をくり返し、最後に白い地へ重ねる。
    // 不透明な背景で止めると、その上の親の opacity を見逃す（2026-11-07 CodeRabbit：opacity .1 の親の中の白いカードの黒い字を 21:1 と測った）。
    // 不透明になったあとは、上に opacity が 1 でない親があるときだけ上へ進む
    const chain = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    let gT = fg, gB = [0, 0, 0, 0], unsure = false;
    for (let i = 0; i < chain.length; i++) {
      const node = chain[i], s = getComputedStyle(node);
      const c = parse(s.backgroundColor) || [0, 0, 0, 0];
      if (s.backgroundImage && s.backgroundImage !== "none") {
        // html・body の地の模様（和紙・布目など）は、下に敷いた地の色で測る（2026-11-05 まんなか漢字で全部の字が測れず、金の字の不足を見逃した）
        if (!((node === document.body || node === document.documentElement) && c[3] === 1)) { unsure = true; break; }
      }
      if (c[3] > 0) { gT = over(gT, c); gB = over(gB, c); }
      const o = +s.opacity;
      if (o < 1) { gT = [gT[0], gT[1], gT[2], gT[3] * o]; gB = [gB[0], gB[1], gB[2], gB[3] * o]; }
      if (gB[3] === 1 && chain.slice(i + 1).every((a) => +getComputedStyle(a).opacity === 1)) break;
    }
    if (unsure) { skipped++; continue; }
    const bg = over(gB, [255, 255, 255, 1]);
    fg = over(gT, [255, 255, 255, 1]);
    const L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    measured++;
    if (ratio + 0.005 < need) {
      const name = el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList.length ? "." + [...el.classList].join(".") : "");
      bad.push(`${name}「${el.textContent.trim().slice(0, 12)}」${ratio.toFixed(2)}<${need}`);
    }
  }
  return { bad, measured, skipped };
};
for (const [label, settings] of [["ふつう", null], ["設定を全部入れた", ALL_ON]]) {
  for (const sc of screens) {
    const { ctx, page, errors } = await openPage({ settings });
    try {
      await go(page, sc);
      const { bad, measured, skipped } = await page.evaluate(contrastFn, skipSel);
      check(`文字のコントラストが 4.5:1 以上（大きい字は 3:1）：${sc.name}・${label}（WCAG 1.4.3）`, measured > 0 && bad.length === 0, bad.length ? `${bad.length}か所 ${bad.slice(0, 8).join(" / ")}` : `${measured}か所を測った${skipped ? `（うしろが絵・グラデーションで測れない${skipped}か所は自分の目で見る）` : ""}`);
      check(`エラーが出ない：${sc.name}・${label}`, errors.length === 0, errors.join(" / "));
      // 設定の印（html の class）で画面そのものがずれないか（2026-11-05 html.a11y-say にボタンの fixed が当たり、画面が左へずれた。incidents/2026-11-05-a11y-say-class-clash.md）
      const lay = await page.evaluate(() => ({ pos: getComputedStyle(document.documentElement).position, wide: document.documentElement.scrollWidth > innerWidth + 1, left: Math.round(document.body.getBoundingClientRect().left) }));
      check(`設定の印で画面がずれない・横にはみ出さない：${sc.name}・${label}`, lay.pos === "static" && !lay.wide && lay.left >= 0, JSON.stringify(lay));
      if (settings) {
        // 押して進んだあとも設定の印が html に残っているか（ゲームが className を書き換えると消える）
        const lost = await page.evaluate((keys) => keys.filter((k) => !document.documentElement.classList.contains("a11y-" + k)), Object.keys(settings).filter((k) => k !== "ruby"));
        check(`操作のあとも設定の印（html の a11y- の class）が残る：${sc.name}`, lost.length === 0, lost.length ? `消えた: ${lost.join(",")}` : "");
        // 「🔊 読む」で読む文があるか（data-a11y-say、無ければ見出し・知らせの場所。どちらも無いと押しても設定の画面が開くだけ）
        const says = await page.evaluate(() => { const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden],[aria-hidden=true],[inert]") && (el.getAttribute("aria-label") || el.innerText || "").trim(); }; return { say: [...document.querySelectorAll("[data-a11y-say]")].filter(vis).length, head: [...document.querySelectorAll("h1,h2,[role=status],[aria-live]")].filter(vis).length }; });
        const noSay = (cfg.noSay || []).find((n) => n.screen === sc.name);
        check(`「🔊 読む」で読む文がある（data-a11y-say か見出し）：${sc.name}`, says.say > 0 || says.head > 0 || noSay, noSay ? `許し：${noSay.reason}` : says.say ? `${says.say}か所` : `data-a11y-say は無く、見出し・知らせ ${says.head}か所を読む（問題・お題のある画面なら data-a11y-say を付ける）`);
      }
    } catch (e) { check(`画面を開ける：${sc.name}・${label}`, false, e.message); }
    await ctx.close();
  }
}

// 4. 字間・行間を広げる（WCAG 1.4.12 の値）＋読みやすい文字。幅320px
const SPACING = "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}p{margin-bottom:2em!important}";
for (const sc of screens) {
  const { ctx, page } = await openPage({ width: 320, settings: { read: true } });
  try {
    await go(page, sc);
    await page.addStyleTag({ content: SPACING });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const wide = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      const cut = [];
      for (const el of document.querySelectorAll("body *")) {
        if (el.closest("svg,canvas,[aria-hidden=true],[hidden]")) continue;
        const cs = getComputedStyle(el);
        if (!/hidden|clip/.test(cs.overflowX + cs.overflowY) || cs.textOverflow === "ellipsis") continue;
        // 読み上げ用に見えなくした字（.sr など、1px の箱や clip）は数えない
        const b = el.getBoundingClientRect();
        if (b.width <= 2 || b.height <= 2 || (cs.clip && cs.clip !== "auto") || (cs.clipPath && cs.clipPath !== "none")) continue;
        // 自分の字か、中の span・ruby など（行の中に並ぶもの）の字が切れていないか（span の中の字を見逃していた。2026-11-07 mukashi-narabe #1 の CodeRabbit）
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        // 中の字は、その字の箱が外にはみ出しているときだけ数える（絵や積み木がはみ出すだけの入れ物を数えない）
        const out = (c) => { const r = c.getBoundingClientRect(); return r.width > 0 && (r.bottom > b.bottom + 2 || r.right > b.right + 2 || r.top < b.top - 2 || r.left < b.left - 2); };
        const inner = !own && [...el.querySelectorAll("*")].some((c) => getComputedStyle(c).display.startsWith("inline") && !c.closest("svg,canvas,[aria-hidden=true],[hidden]") && [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && out(c));
        if (!own && !inner) continue;
        if (inner || el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) cut.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}「${el.textContent.trim().slice(0, 10)}」`);
      }
      return { wide, cut };
    });
    check(`字間・行間を広げても横にはみ出さず、字が切れない：${sc.name}・幅320px（WCAG 1.4.12）`, !r.wide && r.cut.length === 0, `${r.wide ? "横にはみ出す " : ""}${r.cut.slice(0, 8).join(" / ")}`);
  } catch (e) { check(`字間を広げた画面を開ける：${sc.name}`, false, e.message); }
  await ctx.close();
}

// 5. 動きを減らす（端末の設定だけで入る）
{
  const { ctx, page } = await openPage({ reduced: true });
  const r = await page.evaluate(() => ({
    calm: document.documentElement.classList.contains("a11y-calm"),
    moving: document.getAnimations().filter((a) => a.playState === "running" && (a.effect?.getComputedTiming().endTime ?? 0) > 200).map((a) => a.animationName || a.transitionProperty || "動き"),
  }));
  check("端末の「視差効果を減らす」で動きを減らす設定が入り、動き続けるアニメーションが無い（WCAG 2.3.3）", r.calm && r.moving.length === 0, r.moving.join(","));
  await ctx.close();
}

// 6・7・8・1 の続き：キーボード・名前・知らせの場所・斜体・開くボタン
{
  const { ctx, page } = await openPage();
  await dismiss(page);
  const r = await page.evaluate(() => {
    const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
    const noname = [...document.querySelectorAll("button,a[href],[role=button]")].filter(vis).filter((el) => !(el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}‍️\s]/gu, "")) && !el.querySelector("img[alt]:not([alt=''])")).map((el) => el.outerHTML.slice(0, 60));
    const noalt = [...document.querySelectorAll("img:not([alt])")].map((el) => el.src.split("/").pop());
    const italic = [...document.querySelectorAll("body *")].filter((el) => getComputedStyle(el).fontStyle === "italic" && /[぀-ヿ一-鿿]/.test([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(""))).map((el) => el.tagName.toLowerCase());
    const opener = [...document.querySelectorAll("[data-a11y-open]")].some(vis);
    return { noname, noalt, italic, opener };
  });
  check("見やすさの設定を開くボタンがホームに見えている（data-a11y-open）", r.opener);
  check("名前の無いボタン・リンクが無い（記号だけのものは aria-label。WCAG 4.1.2）", r.noname.length === 0, r.noname.join(" / "));
  check("絵に alt がある（飾りは alt=\"\"。WCAG 1.1.1）", r.noalt.length === 0, r.noalt.join(","));
  check("斜体の日本語が無い（BDA Dyslexia Style Guide）", r.italic.length === 0, r.italic.join(","));
  // Tab で10回動かし、選んだ所に枠（outline か box-shadow）が見えるか。
  // 選ぶ前と後を比べる（いつも付いている影だけで通っていた。2026-11-07 CodeRabbit が chikei-ate #1 で指摘）
  const noRing = []; let reached = 0;
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const look = () => { const cs = getComputedStyle(el); return { ol: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 ? `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}` : "", bs: cs.boxShadow && cs.boxShadow !== "none" ? cs.boxShadow : "" }; };
      const on = look(); el.blur(); const off = look(); el.focus(); // キーボードで動かしたあとの focus() は focus-visible のまま
      return { ok: !!((on.ol && on.ol !== off.ol) || (on.bs && on.bs !== off.bs)), name: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") };
    });
    if (f) reached++;
    if (f && !f.ok) noRing.push(f.name);
  }
  // どこにも届かない（全部 tabindex=-1 など）と、枠の検査が空のまま通っていた（2026-11-07 gogen-suiri #1 の CodeRabbit）
  check("キーボード（Tab）でホームの操作部品に届く（WCAG 2.1.1）", reached > 0, `${reached}か所`);
  check("キーボード（Tab）で選んだ所に枠が見える（WCAG 2.4.7）", reached > 0 && noRing.length === 0, noRing.join(","));
  await ctx.close();
}
{
  // 知らせの場所は、遊ぶ画面まで進めた所でも数える
  let live = false;
  for (const sc of screens) {
    const { ctx, page } = await openPage();
    try { await go(page, sc); live = live || await page.evaluate(() => [...document.querySelectorAll("[aria-live],[role=status],[role=alert]")].some((el) => el.getAttribute("aria-live") !== "off" && !el.closest("[aria-hidden=true],[hidden],[inert]"))); } catch { /* 上で数えた */ }
    await ctx.close();
  }
  check("正解・まちがいなどの知らせを読み上げソフトに伝える場所がある（aria-live か role=status。aria-hidden・hidden の中は数えない。WCAG 4.1.3）", live);
}
{
  // 設定の画面が開き、選んだものが html の印になり、次に開いても残る
  const { ctx, page } = await openPage();
  await dismiss(page);
  await page.click("[data-a11y-open]");
  const opened = await page.evaluate(() => !!document.querySelector("dialog.a11y-dlg[open]"));
  await page.check('dialog.a11y-dlg input[data-k="read"]');
  await page.check('dialog.a11y-dlg input[data-k="cvd"]');
  await page.click("dialog.a11y-dlg [data-a11y-close]");
  await page.reload(); await page.waitForTimeout(300);
  const kept = await page.evaluate(() => ["a11y-read", "a11y-cvd"].every((c) => document.documentElement.classList.contains(c)));
  check("見やすさの設定が開き、選んだもの（読みやすい文字・色の見分け）が次に開いても残る", opened && kept);
  // 別のタブで変えた設定を、このタブの保存で消さない（2026-11-05 CodeRabbit）
  const merged = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("a11y-v1") || "{}"); s.ruby = true; localStorage.setItem("a11y-v1", JSON.stringify(s)); window.A11y.set("calm", true); const t = JSON.parse(localStorage.getItem("a11y-v1") || "{}"); return t.ruby === true && t.calm === true && t.read === true; });
  check("別のタブで変えた見やすさの設定を、このタブの保存で消さない", merged);
  // 保存した値がオブジェクトでなくても、設定のボタンと window.A11y が動く
  await page.evaluate(() => localStorage.setItem("a11y-v1", "true"));
  await page.reload(); await page.waitForTimeout(300);
  let odd = await page.evaluate(() => !!window.A11y && !!document.querySelector("[data-a11y-open]"));
  // ボタンがあるだけでなく、押すとダイアログが開くか（2026-11-07 mukashi-narabe #1 の CodeRabbit）
  // 押せない（隠れている・時間切れ）ときも、例外で止めずに ✗ と数える（2026-11-07 amida-haitatsu #14 の CodeRabbit）
  if (odd) {
    await dismiss(page);
    odd = await page.click("[data-a11y-open]", { timeout: 3000 })
      .then(() => page.waitForSelector("dialog.a11y-dlg[open]", { timeout: 2000 }))
      .then(() => true, () => false);
  }
  check("保存した見やすさの設定が壊れていても（true など）、設定を開ける", odd);
  await ctx.close();
}

// 10. 色覚の見え方の絵（Machado ほか 2009 の強さ1.0の行列。人と AI が目で見て、色だけで分けていないか確かめる）
const CVD = {
  P型: "0.152286 1.052583 -0.204868 0 0 0.114503 0.786281 0.099216 0 0 -0.003882 -0.048116 1.051998 0 0 0 0 0 1 0",
  D型: "0.367322 0.860646 -0.227968 0 0 0.280085 0.672501 0.047413 0 0 -0.011820 0.042940 0.968881 0 0 0 0 0 1 0",
  T型: "1.255528 -0.076749 -0.178779 0 0 -0.078411 0.930809 0.147602 0 0 0.004733 0.691367 0.303900 0 0 0 0 0 1 0",
};
const shots = [];
for (const sc of screens) {
  const { ctx, page } = await openPage();
  try {
    await go(page, sc);
    for (const [k, m] of Object.entries(CVD)) {
      await page.evaluate(([k, m]) => {
        document.getElementById("a11y-sim")?.remove();
        const d = document.createElement("div"); d.id = "a11y-sim";
        d.innerHTML = `<svg width="0" height="0" style="position:absolute"><filter id="a11y-f" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${m}"/></filter></svg>`;
        document.body.appendChild(d); document.documentElement.style.filter = "url(#a11y-f)";
      }, [k, m]);
      const file = `a11y-${sc.name}-${k}.png`;
      await page.screenshot({ path: path.join(out, file) });
      shots.push(file);
    }
  } catch (e) { console.log(`色覚の見え方の絵を撮れなかった：${sc.name}（${String(e.message || e).split("\n")[0]}）`); /* 絵だけなので失敗にしない */ }
  await ctx.close();
}
await browser.close();

const fails = results.filter((r) => !r.ok);
const md = `# 見やすさ・読みやすさの検査\n\n${results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? `（${r.detail}）` : ""}`).join("\n")}\n\n${shots.length ? `色覚の見え方の絵（色だけで分けている所が無いか目で見る）：${shots.map((f) => `qa-report/${f}`).join("・")}` : "色覚の見え方の絵：撮れなかった（上の知らせを見る）"}\n`;
writeFileSync(path.join(out, "a11y.md"), md);
console.log(md);
console.log(fails.length ? `見やすさの検査：${fails.length}件の失敗` : `見やすさの検査：全部通った（${results.length}件）`);
process.exit(fails.length ? 1 : 0);
