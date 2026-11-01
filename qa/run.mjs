// うそつき六法（封じの六法）の検査。index.html をブラウザで開き、ページの形と遊び方を確かめる。
// 使い方: node qa/run.mjs   失敗があれば終了コード 1。結果は qa-report/report.md。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = "file://" + path.join(root, "index.html");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);

  // 1. ページの形：6冊×6ページ・うその場所と札がそろう・各巻にうその無いページがある・最後は大きな魔
  const data = await page.evaluate(() => BOOKS.map((b) => ({ id: b.id, name: b.name, pages: b.pages.map((p) => ({ id: p.id, art: p.art, w: p.w, lie: p.lie, bad: p.bad, alt: p.alt, why: p.why })) })));
  const pages = data.flatMap((b) => b.pages);
  check("6冊ある（憲法・民法・刑法・商法・民事訴訟法・刑事訴訟法）", data.map((b) => b.name).join() === "憲法,民法,刑法,商法,民事訴訟法,刑事訴訟法");
  check("どの巻も10ページ", data.every((b) => b.pages.length === 10), data.map((b) => b.pages.length).join(","));
  check("ページの id が重ならない", new Set(pages.map((p) => p.id)).size === pages.length);
  const badShape = pages.filter((p) => p.lie >= 0 && !(p.lie < p.w.length && p.bad && p.bad !== p.w[p.lie] && p.alt?.length === 2
    && new Set([p.w[p.lie], ...p.alt]).size === 3 && !p.alt.includes(p.bad)));
  check("うそのページは、場所・うその言葉・札3枚（正しい言葉を含み、うその言葉は含まない）がそろう", badShape.length === 0, badShape.map((p) => p.id).join(","));
  check("どの巻にも、うその無いページが2〜4ページある", data.every((b) => { const n = b.pages.filter((p) => p.lie < 0).length; return n >= 2 && n <= 4; }));
  check("各巻の最後のページ（大きな魔）には必ずうそがある", data.every((b) => b.pages[b.pages.length - 1].lie >= 0));
  const dupArt = data.flatMap((b) => b.pages.map((p) => p.art)).filter((a, i, xs) => xs.indexOf(a) !== i);
  check("同じ条文のページが重ならない", dupArt.length === 0, dupArt.join(","));
  const lawName = { ken: ["憲法"], min: ["民法"], kei: ["刑法"], sho: ["商法", "会社法"], mso: ["民事訴訟法"], kso: ["刑事訴訟法"] };
  check("条文の名前が巻と合う", data.every((b) => b.pages.every((p) => lawName[b.id].some((n) => p.art.startsWith(n)) && /\d+条/.test(p.art))));
  const long = pages.filter((p) => p.w.join("").length > 45 || (p.lie >= 0 && p.w.join("").length - p.w[p.lie].length + p.bad.length > 45));
  check("1ページの文は45字以内（一目で読める長さ）", long.length === 0, long.map((p) => p.id).join(","));
  check("言葉のかたまりは3つ以上（タップで選べる）", pages.every((p) => p.w.length >= 3));
  check("答え合わせの一言がある", pages.every((p) => p.why && p.why.length <= 80));

  // 1b. ページの並び：1回6ページ・重ならない・大きな魔は最後・まだ直していないページを先に出す（乱数で組むので500回ずつ確かめる）
  const orders = await page.evaluate(() => {
    const bad = [], keep = mem;
    for (const b of BOOKS) {
      const pool = b.pages.slice(0, -1);
      for (let i = 0; i < 500; i++) {
        mem = { solved: {} };
        const o = makeOrder(b);
        if (o.length !== PER || new Set(o).size !== PER || o[PER - 1] !== bossOf(b)) bad.push(`${b.id}:${i}`);
        mem = { solved: Object.fromEntries(pool.slice(0, 7).map((p) => [p.id, true])) };
        const o2 = makeOrder(b);
        if (!pool.slice(7).every((p) => o2.includes(p)) || o2.length !== PER) bad.push(`${b.id}:todo${i}`);
        const firstDone = o2.findIndex((p) => mem.solved[p.id]), lastTodo = o2.slice(0, -1).map((p) => !mem.solved[p.id]).lastIndexOf(true);
        if (firstDone !== -1 && lastTodo > firstDone) bad.push(`${b.id}:todo-first${i}`);
        const r = makeOrder(b, [b.pages[1], bossOf(b)]);
        if (r.length !== 2 || r[1] !== bossOf(b)) bad.push(`${b.id}:only${i}`);
        const r2 = makeOrder(b, [b.pages[2]]);
        if (r2.length !== 1 || r2[0] !== b.pages[2]) bad.push(`${b.id}:only1-${i}`);
      }
    }
    mem = keep; return bad;
  });
  check("ページの並びを3000回作っても、6ページが重ならず、大きな魔は最後、まだのページが先", orders.length === 0, orders.slice(0, 3).join(" / "));
  const cardsOk = await page.evaluate(() => { let bad = 0; for (const p of ALL.filter((x) => x.lie >= 0)) for (let i = 0; i < 100; i++) { const c = shuffle([p.w[p.lie], ...p.alt]); if (c.length !== 3 || !c.includes(p.w[p.lie]) || c.includes(p.bad)) bad++; } return bad; });
  check("札を2500回まぜても、正しい札が必ず入り、うその言葉は入らない", cardsOk === 0, `${cardsOk}回`);

  check("スマホ用の viewport がある", await page.evaluate(() => (document.querySelector('meta[name="viewport"]')?.content || "").includes("width=device-width")));

  // 2. 本棚：6冊の背表紙・前置きは一言・封じ帳
  check("本棚に6冊の背表紙が並ぶ", (await page.locator(".spine").count()) === 6);
  check("前置きは一言（ねじれ文字）", (await page.textContent(".prolog")).includes("ねじれ文字"));
  check("本棚に相棒のしおりがいる（技はまだ無い）", (await page.locator("#buddy .buddy-svg.st0").count()) === 1 && (await page.textContent("#buddy")).includes("まだ無い"));
  check("画面に「人狼」という言葉が無い", !(await page.evaluate(() => document.documentElement.outerHTML)).includes("人狼"));

  // 3. 憲法の巻を全部正しく直す：一画面一問・うそを押すと札が3枚・直すと札に封じる・最後は大きな魔・10ページは2回に分けて読む
  await page.click('.spine[data-book="ken"]');
  check("巻を開くと、1ページだけ出る", (await page.locator(".page").count()) === 1);
  const solve = async (wrong) => {
    const p = await page.evaluate(() => { const p = S.list[S.i]; return { lie: p.lie, right: p.lie >= 0 ? p.w[p.lie] : null }; });
    if (wrong === "word") { await page.click(`.w[data-k="${p.lie === 0 ? 1 : 0}"]`); return p; }
    if (p.lie < 0) { await page.click("#none"); return p; }
    await page.click(`.w[data-k="${p.lie}"]`);
    if (wrong === "card") { await page.locator(".card").filter({ hasNotText: p.right }).first().click(); return p; }
    await page.locator(".card", { hasText: p.right }).first().click();
    return p;
  };
  // 1回分（6ページ）を読む。plan に "word"/"card" を入れると、うそのページでその順に間違える
  const readOnce = async (plan = []) => {
    let lost = 0;
    while ((await page.locator("#fin").count()) === 0) {
      const lie = await page.evaluate(() => S.list[S.i].lie);
      const mode = lie >= 0 && plan.length ? plan.shift() : null;
      await solve(mode); if (mode) lost++;
      await page.click("#next");
    }
    return lost;
  };
  let sawBoss = false, sawSeal = false, sawCards = false, sawWhy = true, power = [], heads = [];
  for (let k = 0; k < 6; k++) {
    if (k === 5) sawBoss = (await page.evaluate(() => S.list[S.i] === bossOf(S.b))) && (await page.locator(".page.boss .chip").count()) === 1;
    const lie = await page.evaluate(() => S.list[S.i].lie);
    if (lie >= 0) {
      await page.click(`.w[data-k="${lie}"]`);
      sawCards = sawCards || (await page.locator(".card").count()) === 3;
      const right = await page.evaluate(() => { const p = S.list[S.i]; return p.w[p.lie]; });
      await page.locator(".card", { hasText: right }).first().click();
      sawSeal = sawSeal || (await page.locator(".res .fuda .stamp").count()) === 1;
    } else await page.click("#none");
    sawWhy = sawWhy && (await page.locator("#res").count()) === 1;
    const head = await page.textContent("#res b");
    heads.push(head);
    power.push((await page.locator(".page.power #res.power").count()) === 1 ? head : "");
    await page.click("#next");
  }
  check("うその言葉を押すと札が3枚出る", sawCards);
  check("正しい札で直すと、札に封じる印が出る", sawSeal);
  check("答えるたびに答え合わせの一言が出る", sawWhy);
  check("1回分の最後のページは大きな魔の印つき", sawBoss);
  check("正しく直したページは、どれも「封じた」か「見破った」になる（逃げられたと出ない）", heads.every((h) => /封じた|見破った/.test(h) && !h.includes("逃げられた")), heads.join(" / "));
  check("3ページ続けて直すと大技が出る（3・6ページ目だけ）", power.map((x) => !!x).join() === "false,false,true,false,false,true" && power[2].includes("しおりの大技「しおりの灯」"), power.join(" / "));
  check("1回目で6ページ直すと「続きを読む」が出る", (await page.textContent("#fin h2")).includes("6 / 10") && (await page.locator("#more").count()) === 1, await page.textContent("#fin h2"));
  await page.click("#more");
  const second = await page.evaluate(() => S.list.map((p) => p.id));
  check("続きは、まだのページ4つと大きな魔から始まる", await page.evaluate(() => S.list.filter((p) => !mem.solved[p.id]).length === 4));
  await readOnce();
  check("全部直すと「巻を取り戻した」になる", (await page.textContent("#fin h2")).includes("憲法の巻を取り戻した"), second.join(","));
  check("全部直したら「逃がした魔を追う」「続きを読む」は出ない", (await page.locator("#chase, #more").count()) === 0);
  check("巻を取り戻すと、相棒が新しい技を覚える", (await page.textContent("#learn")).includes("礎の灯"));
  await page.click("#back");
  check("取り戻した巻は本棚で光り、村に灯りが1つともる", (await page.locator('.spine.done[data-book="ken"]').count()) === 1 && (await page.locator(".town .win.lit").count()) === 1);
  check("本棚の相棒が覚えた技を見せる", (await page.textContent("#buddy")).includes("礎の灯"));
  await page.click('.spine[data-book="ken"]'); await readOnce();
  check("取り戻した巻を読み直しても、技をもう一度覚えたとは出ない", (await page.locator("#fin").count()) === 1 && (await page.locator("#learn").count()) === 0);
  await page.click("#back");
  const kenMons = await page.evaluate(() => BOOKS[0].pages.filter((p) => p.lie >= 0).length);
  check("上の数字が封じた魔の数になる", (await page.textContent("#stat b")) === String(kenMons));

  // 4. 民法の巻：うそでない言葉を押す・違う札を選ぶ → 逃げられる。逃がした魔だけ追い直せる
  await page.click('.spine[data-book="min"]');
  const plan = ["word", "card"];
  let lostN = 0, sawFlee = false, sawAnswer = false;
  while ((await page.locator("#fin").count()) === 0) {
    const lie = await page.evaluate(() => S.list[S.i].lie);
    const mode = lie >= 0 && plan.length ? plan.shift() : null;
    await solve(mode);
    if (mode) { lostN++; sawFlee = sawFlee || (await page.locator(".res .flee").count()) === 1; sawAnswer = sawAnswer || (await page.locator(".text.done .w.ans").count()) === 1; }
    await page.click("#next");
  }
  check("間違えると魔が逃げ、正しい言葉が示される", sawFlee && sawAnswer);
  check("巻の終わりに逃げた魔が並ぶ", (await page.locator("#fin .slot.out").count()) === lostN);
  await page.click("#chase");
  check("「逃がした魔を追う」は逃がしたページだけ出す", (await page.evaluate(() => S.list.length)) === lostN);
  await readOnce();
  await page.click("#more"); await readOnce();
  check("追い直して続きも読むと、民法の巻も取り戻せる", (await page.textContent("#fin h2")).includes("民法の巻を取り戻した"));
  await page.click("#back");

  // 4b. 間違えると力が0に戻る：2ページ直す→間違える→2ページ直すでは大技が出ない（3つ目でやっと出る）
  const resetSeq = await page.evaluate(() => {
    const keep = { S, mem: JSON.stringify(mem) }; const out = [];
    S = { b: BOOKS[2], list: BOOKS[2].pages.slice(), i: 0, st: null, cards: null, got: [], lost: [], streak: 0, best: 0, wasFull: false };
    for (const ok of [true, true, false, true, true, true]) { finish(ok, null); out.push(S.st.power ? "大技" : "-"); S.i++; }
    S = keep.S; mem = JSON.parse(keep.mem); save(); return out.join(",");
  });
  check("間違えるとしおりの力が0に戻る（直す2→間違い→直す2では大技なし、3つ目で出る）", resetSeq === "-,-,-,-,-,大技", resetSeq);

  // 4c. 大技の名前（乱数）：まだ技を覚えていない巻では、覚えた技の中から選ぶ。300回作って毎回確かめる
  const tech = await page.evaluate(() => {
    const xs = learned(), keep = JSON.stringify(mem);
    const other = Array.from({ length: 300 }, () => techFor(BOOKS[2]));
    const random = Math.random; let own;
    try { Math.random = () => 0.999999; own = Array.from({ length: 300 }, () => techFor(BOOKS[0])); } finally { Math.random = random; }
    mem.solved = {}; const none = techFor(BOOKS[2]); mem = JSON.parse(keep);
    return { xs, bad: other.filter((x) => !xs.includes(x)), kinds: new Set(other).size, own, none };
  });
  check("覚えていない巻の大技は、覚えた技から選ぶ（300回）", tech.xs.length >= 2 && !tech.xs.includes("戒めの鎖") && tech.bad.length === 0 && tech.kinds === tech.xs.length, JSON.stringify({ ...tech, own: [...new Set(tech.own)] }));
  check("覚えた巻の大技はその巻の技（乱数をほかの技に寄せて300回）、何も覚えていなければ「しおりの灯」", tech.own.every((x) => x === "礎の灯") && tech.none === "しおりの灯", JSON.stringify({ ...tech, own: [...new Set(tech.own)] }));

  // 5. 記録はこの端末にだけ残り、開き直しても消えない
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(KEY) || "{}"));
  check("直したページが記録される", Object.keys(saved.solved || {}).length === 20, Object.keys(saved.solved || {}).length + "ページ");
  await page.reload();
  check("開き直しても本棚の光は残る", (await page.locator(".spine.done").count()) === 2);

  // 6. 封じ帳：封じた魔が並び、まだのところは「？」
  await page.click("#cho");
  const got = await page.locator("#chobook .slot.got").count(), all = await page.evaluate(() => MONS.length);
  const want = await page.evaluate(() => BOOKS.slice(0, 2).flatMap((b) => b.pages).filter((p) => p.lie >= 0).length);
  check("封じ帳に封じた魔が並ぶ", got === want && (await page.locator("#chobook .slot").count()) === all, `${got}/${all}`);
  await page.click("#back");

  // 7. 残りの4冊を直すと夜明け
  for (const id of ["kei", "sho", "mso", "kso"]) {
    await page.click(`.spine[data-book="${id}"]`);
    await readOnce(); await page.click("#more"); await readOnce();
    await page.click("#back");
  }
  const buddyText = await page.textContent("#buddy");
  check("6冊そろうと相棒が金色に育ち、技が6つ", (await page.locator("#buddy .buddy-svg.st3").count()) === 1 && ["礎の灯", "結びの糸", "戒めの鎖", "算盤の風", "天秤の盾", "黙の帳"].every((x) => buddyText.includes(x)), buddyText);
  check("6冊すべて取り戻すと夜明けになり、村の灯りが6つ", (await page.locator("#dawn").count()) === 1 && (await page.evaluate(() => document.body.classList.contains("dawn"))) && (await page.locator(".town .win.lit").count()) === 6);

  // 8. 記録が壊れていても、記録を拒むブラウザでも遊べる
  const p2 = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const err2 = [];
  p2.on("pageerror", (e) => err2.push(e.message));
  await p2.addInitScript(() => { try { localStorage.setItem("roppo-seal-v1", "{こわれた"); } catch (e) {} });
  await p2.goto(url);
  check("記録が壊れていても本棚が出る", (await p2.locator(".spine").count()) === 6 && err2.length === 0, err2.join(" / "));
  await p2.close();

  // 9. 応援のリンク：Ko-fi へのただのリンクだけ（外のスクリプトを読まず、遊ぶ人の記録を外へ送らない）
  const kofi = await page.locator("#kofi").evaluate((a) => ({ href: a.href, rel: a.rel })).catch(() => null);
  check("応援のリンクが Ko-fi のページを指す", kofi && kofi.href === "https://ko-fi.com/satouaaaaa", kofi?.href || "無い");
  check("応援のリンクは noopener つき", kofi && kofi.rel.includes("noopener"));
  check("外のスクリプトを読まない", (await page.locator("script[src]").count()) === 0);

  // 10. 前の版（classic.html）も開ける
  const p3 = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const err3 = [];
  p3.on("pageerror", (e) => err3.push(e.message));
  await p3.goto("file://" + path.join(root, "classic.html"));
  check("前の版（classic.html）がエラーなく開く", (await p3.locator(".person").count()) === 1 && err3.length === 0, err3.join(" / "));
  await p3.close();

  // 11. スマホ幅で横にはみ出さない（本棚・ページ・封じ帳）・エラーが出ない
  const wide = [];
  await page.evaluate(() => { localStorage.removeItem(KEY); mem = load(); shelf(); });
  if ((await page.evaluate(() => document.documentElement.scrollWidth)) > 390) wide.push("本棚");
  await page.click('.spine[data-book="kso"]');
  while ((await page.locator("#fin").count()) === 0) {
    const lie = await page.evaluate(() => S.list[S.i].lie);
    if (lie >= 0) { await page.click(`.w[data-k="${lie}"]`); if ((await page.evaluate(() => document.documentElement.scrollWidth)) > 390) wide.push("札"); }
    else await page.click("#none");
    if (lie >= 0) { const right = await page.evaluate(() => { const p = S.list[S.i]; return p.w[p.lie]; }); await page.locator(".card", { hasText: right }).first().click(); }
    if ((await page.evaluate(() => document.documentElement.scrollWidth)) > 390) wide.push("答え合わせ");
    await page.click("#next");
  }
  await page.click("#back"); await page.click("#cho");
  if ((await page.evaluate(() => document.documentElement.scrollWidth)) > 390) wide.push("封じ帳");
  check("スマホ幅で横にはみ出さない（本棚・札・答え合わせ・封じ帳）", wide.length === 0, wide.join(","));
  check("ページのエラーが無い", errors.length === 0, errors.join(" / "));

  // 12. PWA：ホーム画面に置ける形（manifest・アイコン）と、一度開けば電波が無くても遊べる（sw.js）。http で開いて確かめる
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png" };
  let down = false;   // true のあいだ、サーバーが 503 を返す
  const server = http.createServer((req, res) => {
    if (down) { res.writeHead(503); res.end("down"); return; }
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(root, rel);
    if ((file !== root && !file.startsWith(root + path.sep)) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" }); res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  try {
    const pw = await ctx.newPage();
    const errPw = []; pw.on("pageerror", (e) => errPw.push(e.message));
    await pw.goto(base);
    const man = await pw.evaluate(async () => { const href = document.querySelector('link[rel="manifest"]')?.getAttribute("href"); return href ? (await fetch(href)).json() : null; });
    const icons = man?.icons || [];
    check("manifest に名前・開く場所・アプリ表示・192と512のアイコンがある", man && man.name === "うそつき六法" && man.start_url && man.display === "standalone"
      && ["192x192", "512x512"].every((sz) => icons.some((i) => i.sizes === sz)) && icons.some((i) => i.purpose === "maskable"), JSON.stringify(man));
    const iconOk = await pw.evaluate(async (list) => (await Promise.all(list.map((i) => fetch(i.src).then((r) => r.ok && r.headers.get("content-type") === "image/png")))).every(Boolean), icons);
    check("アイコンの画像が取れる", iconOk);
    await pw.evaluate(() => navigator.serviceWorker.ready);
    await pw.reload(); await pw.waitForFunction(() => !!navigator.serviceWorker.controller);
    check("sw.js が入り、画面を受け持つ", await pw.evaluate(() => !!navigator.serviceWorker.controller));
    await ctx.setOffline(true);
    const offErr = await pw.reload().then(() => "", (e) => e.message.split("\n")[0]);
    check("電波が無くても本棚が開き、6冊並ぶ", !offErr && (await pw.locator(".spine").count()) === 6, offErr);
    if (!offErr) await pw.click('.spine[data-book="ken"]');
    check("電波が無くてもページが読める", (await pw.locator(".w").count()) >= 3);
    const offErr2 = await pw.goto(base + "classic.html").then(() => "", (e) => e.message.split("\n")[0]);
    check("電波が無くても前の版（classic.html）が開く", !offErr2 && (await pw.locator(".person").count()) === 1, offErr2);
    await ctx.setOffline(false); down = true;
    const downErr = await pw.goto(base).then(() => "", (e) => e.message.split("\n")[0]);
    check("サーバーが 503 を返しても、保存した本棚が開く", !downErr && (await pw.locator(".spine").count()) === 6, downErr);
    down = false;
    check("PWA の確かめでページのエラーが無い", errPw.length === 0, errPw.join(" / "));
  } finally { await ctx.close(); server.close(); }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
const md = ["# QA うそつき六法", "", ...results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? `（${r.detail}）` : ""}`), "", failed.length ? `❌ ${failed.length}件失敗` : "✅ 全部通った"].join("\n");
mkdirSync(path.join(root, "qa-report"), { recursive: true });
writeFileSync(path.join(root, "qa-report", "report.md"), md + "\n");
console.log(md);
process.exit(failed.length ? 1 : 0);
