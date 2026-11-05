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
  // 2b. はじめての人：下読みありで始まり、民法の巻に「はじめに」の印。ここからの検査は下読みなし（今までの遊び方）で通す
  check("はじめての人は「下読みあり」から始まる", await page.evaluate(() => mem.opt.easy === true) && (await page.textContent("#easy")).includes("下読みあり"));
  check("はじめての人には、民法の巻にだけ「はじめに」の印が出る", (await page.locator(".spine .first").count()) === 1 && (await page.locator('.spine[data-book="min"] .first').count()) === 1);
  await page.click("#easy");
  check("本棚のボタンで「下読みなし」に切り替えられ、記録に残る", (await page.textContent("#easy")).includes("下読みなし") && await page.evaluate(() => JSON.parse(localStorage.getItem(KEY)).opt.easy === false));
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
  check("途中の区切り（6 / 10）では応援のひとことを出さない", (await page.locator(".ask").count()) === 0);
  await page.click("#more");
  const second = await page.evaluate(() => S.list.map((p) => p.id));
  check("続きは、まだのページ4つと大きな魔から始まる", await page.evaluate(() => S.list.filter((p) => !mem.solved[p.id]).length === 4));
  await readOnce();
  check("全部直すと「巻を取り戻した」になる", (await page.textContent("#fin h2")).includes("憲法の巻を取り戻した"), second.join(","));
  check("全部直したら「逃がした魔を追う」「続きを読む」は出ない", (await page.locator("#chase, #more").count()) === 0);
  check("巻を取り戻すと、相棒が新しい技を覚える", (await page.textContent("#learn")).includes("礎の灯"));
  check("巻を初めて取り戻した画面にだけ、応援のひとこと（Ko-fi へのただのリンク）が出る", (await page.locator("#askfin a").getAttribute("href")) === "https://ko-fi.com/satouaaaaa");
  await page.click("#back");
  check("取り戻した巻は本棚で光り、村に灯りが1つともる", (await page.locator('.spine.done[data-book="ken"]').count()) === 1 && (await page.locator(".town .win.lit").count()) === 1);
  check("本棚の相棒が覚えた技を見せる", (await page.textContent("#buddy")).includes("礎の灯"));
  await page.click('.spine[data-book="ken"]'); await readOnce();
  check("取り戻した巻を読み直しても、技をもう一度覚えたとは出ない", (await page.locator("#fin").count()) === 1 && (await page.locator("#learn").count()) === 0);
  check("取り戻した巻を読み直しても、応援のひとことは出さない（何度も頼まない）", (await page.locator(".ask").count()) === 0);
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
    S = keep.S; mem = JSON.parse(keep.mem); localStorage.setItem(KEY, keep.mem); return out.join(",");
  });
  check("間違えるとしおりの力が0に戻る（直す2→間違い→直す2では大技なし、3つ目で出る）", resetSeq === "-,-,-,-,-,大技", resetSeq);

  // 4b2. 別のタブとの記録：同じ日のページ数は足し合わせ、別のタブでそろえた巻では「新しい技」を出さない
  const tabs = await page.evaluate(() => {
    const keep = { S, mem: JSON.stringify(mem) }, b = BOOKS[3], d = today();
    const other = JSON.parse(keep.mem); other.days[d] = (other.days[d] || 0) + 6; for (const p of b.pages) other.solved[p.id] = true;
    mem = JSON.parse(keep.mem); for (const p of b.pages) delete mem.solved[p.id];
    localStorage.setItem(KEY, JSON.stringify(other));
    S = { b, list: [b.pages[0]], i: 0, st: null, cards: null, got: [], lost: [], streak: 0, best: 0 };
    const before = other.days[d]; finish(true, null); const days = mem.days[d];
    next(); const learnOther = !!document.querySelector("#learn");
    mem = JSON.parse(keep.mem); for (const p of b.pages) delete mem.solved[p.id]; for (const p of b.pages.slice(1)) mem.solved[p.id] = true; localStorage.setItem(KEY, JSON.stringify(mem));
    S = { b, list: [b.pages[0]], i: 0, st: null, cards: null, got: [], lost: [], streak: 0, best: 0 };
    finish(true, null); next(); const learnOwn = !!document.querySelector("#learn");
    S = keep.S; mem = JSON.parse(keep.mem); localStorage.setItem(KEY, keep.mem);
    return { days, before, learnOther, learnOwn };
  });
  check("別のタブで同じ日に読んだページ数に、このタブの1ページを足す（上書きしない）", tabs.days === tabs.before + 1, JSON.stringify(tabs));
  check("別のタブでそろえた巻では「新しい技」を出さず、この回の1ページでそろえたときは出す", !tabs.learnOther && tabs.learnOwn, JSON.stringify(tabs));

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
  check("夜明けの画面に応援のひとことが出る", (await page.locator("#askdawn a").getAttribute("href").catch(() => null)) === "https://ko-fi.com/satouaaaaa");

  // 8. 記録が壊れていても、記録を拒むブラウザでも遊べる
  const p2 = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const err2 = [];
  p2.on("pageerror", (e) => err2.push(e.message));
  await p2.addInitScript(() => { try { localStorage.setItem("roppo-seal-v1", "{こわれた"); } catch (e) {} });
  await p2.goto(url);
  check("遊ぶ前（はじめの本棚）には応援のひとことを出さない", (await p2.locator(".ask").count()) === 0);
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
  await page.evaluate(() => { localStorage.removeItem(KEY); mem = load(); mem.opt.easy = false; shelf(); });
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

  // 13. やりこみ：古い記録を消さない・しおりに聞く・完封・実績・カレンダー（幅320pxの新しい画面で確かめる）
  // QA_SHIFT_DAYS=n で「今日」を n 日ずらして通す（月の1日・月末をまたぐ日でも動くか。例：今日が11/4 なら QA_SHIFT_DAYS=-4 で11/1）
  const shift = Number(process.env.QA_SHIFT_DAYS || 0);
  const q = await browser.newPage({ viewport: { width: 320, height: 760 } });
  if (shift) await q.clock.setFixedTime(new Date(Date.now() + shift * 86400e3));
  const errQ = []; q.on("pageerror", (e) => errQ.push(e.message));
  await q.addInitScript(() => { if (!sessionStorage.getItem("qa-once")) { sessionStorage.setItem("qa-once", "1"); localStorage.setItem("roppo-seal-v1", JSON.stringify({ solved: { ken1: true }, days: [1], keep: 5 })); } });
  await q.goto(url);
  const old = await q.evaluate(() => ({ s: mem.solved.ken1, keep: mem.keep, kinds: ["days", "kanpu", "ach"].every((k) => mem[k] && typeof mem[k] === "object" && !Array.isArray(mem[k])) }));
  check("古い記録（solved だけ・形のちがう入れ物）を読んでも、直したページと知らない入れ物を消さず、足りない入れ物を補う", old.s === true && old.keep === 5 && old.kinds, JSON.stringify(old));
  await q.evaluate(() => { localStorage.removeItem(KEY); mem = load(); mem.opt.easy = false; shelf(); });

  const jst = await q.evaluate(() => [dayOf(Date.UTC(2026, 10, 4, 14, 59)), dayOf(Date.UTC(2026, 10, 4, 15, 0)), prevDay("2026-11-01"), prevDay("2028-03-01")]);
  check("日付は日本時間で数える（UTC 15時で次の日・月や閏年をまたいで前の日）", jst.join() === "2026-11-04,2026-11-05,2026-10-31,2028-02-29", jst.join());

  // しおりに聞く：どのページでも、うその言葉は緑にせず、候補を2つ以上残す。同じページは何度聞いても同じ（500回）
  const hw = await q.evaluate(() => {
    const bad = [];
    for (const p of ALL) {
      const h0 = JSON.stringify(hintWords(p));
      for (let i = 0; i < 500; i++) if (JSON.stringify(hintWords(p)) !== h0) { bad.push(p.id + ":ちがう"); break; }
      const h = hintWords(p), left = p.w.length - h.length;
      if (!h.length || h.includes(p.lie) || new Set(h).size !== h.length || h.some((k) => k < 0 || k >= p.w.length) || left < 2) bad.push(p.id);
    }
    return bad;
  });
  check("しおりは、うその言葉を緑にせず候補を2つ以上残し、同じページは毎回同じ言葉を緑にする（60ページ×500回）", hw.length === 0, hw.join(","));

  const solveQ = async (wrong) => {
    const p = await q.evaluate(() => { const p = S.list[S.i]; return { lie: p.lie, right: p.lie >= 0 ? p.w[p.lie] : null }; });
    if (wrong && p.lie >= 0) { await q.click(`button.w:not([data-k="${p.lie}"])`); }
    else if (p.lie < 0) await q.click("#none");
    else { await q.click(`.w[data-k="${p.lie}"]`); await q.locator(".card", { hasText: p.right }).first().click(); }
    return p;
  };
  const runQ = async (opt = {}) => {
    let k = 0, wrongDone = false;
    while ((await q.locator("#fin").count()) === 0) {
      if (opt.hint && k === 0) await q.click("#shiori");
      if (k === 1) opt.noShiori = (await q.locator("#shiori").count()) === 0;
      const lie = await q.evaluate(() => S.list[S.i].lie);
      const w = opt.wrong && !wrongDone && lie >= 0; if (w) wrongDone = true;
      await solveQ(w); await q.click("#next"); k++;
    }
    return { k, ...opt };
  };
  // 1回目：しおりに聞く → 緑の言葉は押せず、2ページ目からは出ない。全部正しくても完封にならない
  await q.click('.spine[data-book="ken"]');
  const hp = await q.evaluate(() => S.list[0]);
  await q.click("#shiori");
  const hintUi = await q.evaluate(() => { const ws = [...document.querySelectorAll(".text .w")], p = S.list[0];
    return { ok: [...document.querySelectorAll(".text .w.okw")].map((x) => x.tagName), green: ws.map((x, k) => x.classList.contains("okw") ? k : -1).filter((k) => k >= 0).join(), want: hintWords(p).join(), lieGreen: p.lie >= 0 && ws[p.lie].classList.contains("okw"), says: document.querySelector(".q").textContent }; });
  check("しおりに聞くと、hintWords の言葉だけが緑になり押せなくなる（うその言葉は緑にしない）", hintUi.ok.length && hintUi.green === hintUi.want && !hintUi.lieGreen && hintUi.ok.every((t) => t === "SPAN") && hintUi.says.includes("緑"), JSON.stringify(hintUi));
  const after = await runQ();
  check("しおりに聞けるのは1回に1度（次のページからは出ない）", after.noShiori === true && await q.evaluate(() => S === null || S.hint === 0), JSON.stringify({ noShiori: after.noShiori }));
  check("しおりに聞いた回は、全部正しくても完封にならず、条件を一言出す", (await q.locator("#kanpu").count()) === 0 && (await q.textContent("#kanhint")).includes("しおりに聞かずに") && await q.evaluate(() => !mem.kanpu.ken));
  const newAch = await q.textContent("#newach").catch(() => "");
  check("新しくとれた実績を、結果の画面に小さく「🏅 実績：」で出す", newAch.startsWith("🏅 実績：") && newAch.includes("はじめての封印"), newAch);
  check("その日に読んだページ数がカレンダー用に記録される", await q.evaluate((n) => mem.days[today()] === n, after.k), String(after.k));
  check("結果の画面が幅320pxで横にはみ出さない", (await q.evaluate(() => document.documentElement.scrollWidth)) <= 320);
  // 2回目：しおりに聞かず全部一度で直す → 完封。巻の背に「完」
  await q.click("#more"); await runQ();
  const kp = await q.textContent("#kanpu").catch(() => "");
  check("しおりに聞かず6ページを一度で直すと「完封！」になり、記録に残る", kp.includes("完封") && kp.includes("印が付いた") && await q.evaluate(() => mem.kanpu.ken === 1), kp);
  check("一度知らせた実績は、次の結果ではもう出さない", !((await q.textContent("#newach").catch(() => "")).includes("はじめての封印")));
  await q.click("#back");
  // 別のタブ（古い画面）の上書き：タブAが完封を保存したあと、前から開いていたタブB（記録を読む前の古い mem）でまちがえても、
  // 完封・封印・実績・その日の数を消さない。タブBは同じ localStorage を使う画面で、mem だけ古いものにして作る
  {
    const snap = () => q.evaluate(() => { const m = JSON.parse(localStorage.getItem(KEY)); return { kan: m.kanpu.ken, solved: Object.keys(m.solved).length, ach: Object.keys(m.ach).length, day: m.days[today()] || 0 }; });
    const want = await snap();
    await q.evaluate(() => { mem = fresh(); mem.opt.easy = false; shelf(); });
    await q.click('.spine[data-book="ken"]');
    const lie = await q.evaluate(() => S.list[S.i].lie);
    await q.click(lie >= 0 ? `button.w:not([data-k="${lie}"])` : `.w[data-k="0"]`);
    const got = await snap();
    check("古いタブでまちがえて保存しても、別のタブが残した完封・封印・実績・その日の数を消さない", got.kan === 1 && got.solved >= want.solved && got.ach >= want.ach && got.day >= want.day, JSON.stringify({ want, got }));
    // 記録が読めない形になっていても、手元の進み具合を捨てない
    const keepMine = await q.evaluate(() => { const was = localStorage.getItem(KEY); localStorage.setItem(KEY, "{こわれた"); mem.solved.qaX = true; save();
      const ok = JSON.parse(localStorage.getItem(KEY)).solved.qaX === true && mem.kanpu.ken === 1; localStorage.setItem(KEY, was); mem = load(); shelf(); return ok; });
    check("記録が読めない形になっていても、保存は手元の進み具合を残す", keepMine);
  }
  check("完封した巻の背に「完」の印が付く", (await q.locator('.spine[data-book="ken"] .kan').count()) === 1 && (await q.locator(".spine .kan").count()) === 1);
  // まちがえた回・逃がした魔を追う回は完封にならない
  await q.click('.spine[data-book="min"]'); await runQ({ wrong: true });
  check("まちがえた回は完封にならず「6ページを一度で直すと完封」と出る", (await q.locator("#kanpu").count()) === 0 && (await q.textContent("#kanhint")).includes("完封") && await q.evaluate(() => !mem.kanpu.min));
  await q.click("#chase"); await runQ();
  check("逃がした魔を追う回（6ページでない）は完封にならない", (await q.locator("#kanpu, #kanhint").count()) === 0 && await q.evaluate(() => !mem.kanpu.min));
  // 6ページ全部まちがえたあとの追い直し（6ページ）も完封にならない
  await q.click("#back"); await q.click('.spine[data-book="mso"]');
  while ((await q.locator("#fin").count()) === 0) {
    const lie = await q.evaluate(() => S.list[S.i].lie);
    await q.click(lie >= 0 ? `button.w:not([data-k="${lie}"])` : `.w[data-k="0"]`); await q.click("#next");
  }
  await q.click("#chase"); const ch6 = await q.evaluate(() => S.list.length); await runQ();
  check("6ページ全部まちがえたあとの追い直し（6ページ）も完封にならない", ch6 === 6 && (await q.locator("#kanpu").count()) === 0 && await q.evaluate(() => !mem.kanpu.mso), String(ch6));
  await q.click("#back");

  // 実績：10〜14個・腕前/集める/続けるをまぜる・いまの記録から数える
  const ach = await q.evaluate(() => {
    const keep = mem, ids = ACH.map((a) => a.id), kinds = new Set(ACH.map((a) => a.of));
    const none = achNow(fresh());
    const all = fresh(); ALL.forEach((p) => { all.solved[p.id] = true; }); BOOKS.forEach((b) => { all.kanpu[b.id] = 1; });
    for (let i = 0, d = "2026-11-04"; i < 15; i++, d = prevDay(d)) all.days[d] = 1;
    const full = achNow(all);
    const part = fresh(); part.days = { "2026-11-01": 3, "2026-11-03": 1, "2026-11-04": 0 }; part.kanpu = { ken: 1, sho: 1 };
    const pr = Object.fromEntries(achNow(part).map((a) => [a.id, `${a.cur}/${a.goal}`]));
    mem = keep;
    return { n: ACH.length, uniq: new Set(ids).size === ids.length, kinds: [...kinds], none: none.filter((a) => a.done || a.cur).length, full: full.filter((a) => !a.done).map((a) => a.id), pr };
  });
  check("実績はちょうど13個で、id が重ならない", ach.n === 13 && ach.uniq, String(ach.n));
  check("実績は腕前（完封）・集める（封じ帳・巻）・続ける（遊んだ日の合計）をまぜる", ["kan", "sealed", "books", "days"].every((k) => ach.kinds.includes(k)), ach.kinds.join(","));
  check("実績は記録から数える：何も無ければ0、全部そろえば全部とれる", ach.none === 0 && ach.full.length === 0, JSON.stringify(ach.full));
  check("遊んだ日は合計で数え、0ページの日は数えない（進み具合 2/3・完封 2/3）", ach.pr.d3 === "2/3" && ach.pr.kan3 === "2/3" && ach.pr.kan1 === "1/1", JSON.stringify(ach.pr));
  await q.click("#achbtn");
  const av = await q.evaluate(() => ({ rows: document.querySelectorAll("#achview .ach").length, prog: [...document.querySelectorAll("#achview .ach.no .pr")].every((x) => /^\d+\/\d+$/.test(x.textContent)), got: [...document.querySelectorAll("#achview .ach.got .pr")].every((x) => x.textContent === "✓"), sw: document.documentElement.scrollWidth }));
  check("実績の画面に全部並び、まだのものは「いま/目標」、とれたものは ✓", av.rows === ach.n && av.prog && av.got, JSON.stringify(av));
  check("実績の画面が幅320pxで横にはみ出さない", av.sw <= 320, String(av.sw));
  await q.click("#back");

  // カレンダー：遊んだ日に灯り（読んだ数で3段）・前の月へ戻れる・続けた日は1以上のときだけ・休んだ日を責めない
  const cal = await q.evaluate(() => {
    const t = today(), y1 = prevDay(t), m0 = t.slice(0, 7);
    const back = new Date(Date.UTC(+m0.slice(0, 4), +m0.slice(5, 7) - 2, 10)).toISOString().slice(0, 10);
    const out = {};
    mem.days = { [back]: 3 }; calView(m0);
    out.noStreak = !document.getElementById("streak");
    out.prevOn = !document.getElementById("prevm").disabled; out.nextOff = document.getElementById("nextm").disabled;
    document.getElementById("prevm").click();
    out.back = document.querySelector(`#cal [data-day="${back}"]`)?.className || "";
    out.firstOff = document.getElementById("prevm").disabled;
    mem.days = { [y1]: 1 }; calView(m0); out.s1 = document.getElementById("streak")?.textContent || "";
    mem.days = { [y1]: 6, [t]: 12, [prevDay(prevDay(t))]: 0 }; calView(m0);
    out.s2 = document.getElementById("streak")?.textContent || "";
    // きのうが前の月（今日が1日）でも、その日の月まで戻して見る
    out.lv = [y1, t].map((d) => { calView(d.slice(0, 7)); return document.querySelector(`#cal [data-day="${d}"]`)?.className.match(/l\d/)?.[0]; });
    calView(y1.slice(0, 7)); out.only = document.getElementById("prevm").disabled;
    out.text = document.getElementById("calview").textContent;
    out.sw = document.documentElement.scrollWidth;
    out.streak = [streakOf({ "2026-10-31": 1, "2026-11-01": 2 }, "2026-11-01"), streakOf({ "2026-10-30": 1, "2026-11-01": 2 }, "2026-11-01"), streakOf({ "2026-10-31": 1 }, "2026-11-01"), streakOf({ "2026-10-30": 1 }, "2026-11-01")].join();
    return out;
  });
  check("遊んでいない日が続いたら、続けた日は出さない", cal.noStreak);
  check("前の月へ戻れて、前の月の遊んだ日にも灯りが出る（今月より先へは進めない）", cal.prevOn && cal.nextOff && cal.back.includes("l1") && cal.firstOff, JSON.stringify(cal));
  check("続けた日は1以上なら出し（きのうまで遊んだ日も1）、月をまたいでも数える", cal.s1.includes("1日") && cal.s2.includes("2日") && cal.streak === "2,1,1,0", JSON.stringify({ s1: cal.s1, s2: cal.s2, st: cal.streak }));
  check("灯りは読んだページの数で明るくなる（6ページで2段・12ページで3段）", cal.lv.join() === "l2,l3" && cal.only, cal.lv.join());
  check("カレンダーに休んだ日を責める言葉が無い", !/休|さぼ|サボ|途切|残念|忘れ/.test(cal.text), cal.text);
  check("カレンダーの画面が幅320pxで横にはみ出さない", cal.sw <= 320, String(cal.sw));

  // 押せる所の高さ（44px以上）とキーで選んだときの枠（2px以上）
  const small = [], noRing = [];
  const measure = async (where) => {
    for (const r of await q.evaluate(() => [...document.querySelectorAll("button, .btn, a.btn")].filter((x) => x.offsetParent).map((x) => ({ t: x.id || x.className || x.textContent.slice(0, 6), h: x.getBoundingClientRect().height }))))
      if (r.h < 44) small.push(`${where}:${r.t}:${Math.round(r.h)}`);
    await q.keyboard.press("Shift");
    for (const r of await q.evaluate(() => [...document.querySelectorAll("button")].filter((x) => x.offsetParent && !x.disabled).map((x) => { x.focus(); const o = getComputedStyle(x); return { t: x.id || x.className, ok: x.matches(":focus-visible") && parseFloat(o.outlineWidth) >= 2 && o.outlineStyle !== "none" }; })))
      if (!r.ok) noRing.push(`${where}:${r.t}`);
  };
  await q.evaluate(() => { mem.days = {}; shelf(); }); await measure("本棚");
  await q.click("#achbtn"); await measure("実績"); await q.click("#back");
  await q.click("#calbtn"); await measure("カレンダー"); await q.click("#back");
  await q.click('.spine[data-book="sho"]'); await measure("ページ");
  const lie0 = await q.evaluate(() => S.list[S.i].lie);
  if (lie0 >= 0) { await q.click(`.w[data-k="${lie0}"]`); await measure("札"); }
  check("押せる所（本棚・実績・カレンダー・ページの言葉・札）は高さ44px以上（幅320px）", small.length === 0, small.join(" / "));
  check("キーで選ぶと、どのボタンにも2px以上の枠が出る", noRing.length === 0, noRing.join(" / "));
  check("やりこみの確かめでページのエラーが無い", errQ.length === 0, errQ.join(" / "));
  await q.close();

  const src = readFileSync(path.join(root, "index.html"), "utf8");
  check("Math.random は札・ページの並びと大技の名前の2か所だけ（増やさない）", (src.match(/Math\.random/g) || []).length === 2);
  check("sort の比較の中で乱数を引かない", !/sort\([^)]*(random|r\(\))/.test(src));

  // 14. 下読み（法律を知らなくても遊べる）：先に正しい条文だけを見せ、めくるとねじれ文字のページ。完封は下読みなしのときだけ
  {
    const e = await browser.newPage({ viewport: { width: 320, height: 760 } });
    const errE = []; e.on("pageerror", (x) => errE.push(x.message));
    await e.goto(url);
    await e.click('.spine[data-book="min"]');
    const seen = [], leaks = [];
    // 画面に式のかけら（${…}）がそのまま出ていないか（2026-11-05 文字列の引用符をまちがえて、本棚のボタンに式が出た）
    const leak = async (where) => { if (await e.evaluate(() => /\$\{|=>/.test(document.body.innerText))) leaks.push(where); };
    await e.evaluate(() => shelf()); await leak("本棚"); await e.click('.spine[data-book="min"]');
    let sawPeekEvery = true, sawSay = true, firstPeek = null;
    while ((await e.locator("#fin").count()) === 0) {
      const pk = await e.evaluate(() => { const p = S.list[S.i]; return { id: p.id, lie: p.lie, right: p.lie >= 0 ? p.w[p.lie] : null, bad: p.bad || null, correct: p.w.join(""),
        peek: !!document.querySelector("#peek"), text: document.querySelector(".text")?.textContent, btns: document.querySelectorAll(".text button, #none, #shiori, .card").length,
        says: document.querySelector(".q")?.textContent || "" }; });
      if (!firstPeek) firstPeek = pk;
      await leak("下読み");
      seen.push(pk.id);
      if (!pk.peek || pk.text !== pk.correct || pk.btns !== 0 || (pk.bad && pk.text.includes(pk.bad) && !pk.correct.includes(pk.bad)) || /うそは無い|うそがある/.test(pk.says)) sawPeekEvery = false;
      await e.click("#flip");
      const after = await e.evaluate(() => ({ peek: !!document.querySelector("#peek"), says: document.querySelector(".q").textContent, none: !!document.querySelector("#none") }));
      if (after.peek || !after.none || !after.says.includes("下読みとちがう")) sawSay = false;
      await leak("ページ");
      if (pk.lie < 0) await e.click("#none");
      else { await e.click(`.w[data-k="${pk.lie}"]`); await e.locator(".card", { hasText: pk.right }).first().click(); }
      await e.click("#next");
    }
    check("下読みありでは、どのページも先に正しい条文だけが出る（押せる言葉・札・うその有無の言葉は無い）", sawPeekEvery && seen.length === 6, JSON.stringify(firstPeek));
    check("「めくる」と、ねじれ文字のページになり「下読みとちがう言葉をタップ」と出る", sawSay);
    await leak("巻の終わり");
    check("画面に式のかけら（${…}・=>）がそのまま出ない（本棚・下読み・ページ・巻の終わり）", leaks.length === 0, [...new Set(leaks)].join(","));
    check("下読みありで6ページ全部直しても完封にならず、「下読みなしで」と一言出す", (await e.locator("#kanpu").count()) === 0 && (await e.textContent("#kanhint")).includes("下読みなしで") && await e.evaluate(() => !mem.kanpu.min));
    check("下読みありで直したページも封じ帳・記録に残る", await e.evaluate(() => S.got.length === 6 && S.got.every((p) => mem.solved[p.id])));
    await e.click("#back");
    check("1ページでも直したら「はじめに」の印は消える", (await e.locator(".spine .first").count()) === 0);
    await e.reload();
    check("開き直しても下読みありのまま（直した記録があっても、決めた設定を変えない）", await e.evaluate(() => mem.opt.easy === true) && (await e.textContent("#easy")).includes("下読みあり"));
    check("下読みの画面が幅320pxで横にはみ出さない", await (async () => { await e.click('.spine[data-book="ken"]'); return (await e.evaluate(() => document.documentElement.scrollWidth)) <= 320 && (await e.locator("#peek").count()) === 1; })());
    await e.addInitScript(() => { if (!sessionStorage.getItem("qa-old")) { sessionStorage.setItem("qa-old", "1"); localStorage.setItem("roppo-seal-v1", JSON.stringify({ solved: { ken1: true } })); } });
    await e.reload();
    check("今までの記録がある人（設定が無い）は、下読みなしのまま（遊び方を勝手に変えない）", await e.evaluate(() => mem.opt.easy === false) && (await e.locator(".spine .first").count()) === 0);
    check("下読みの検査でページのエラーが無い", errE.length === 0, errE.join(" / "));
    await e.close();
  }

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
