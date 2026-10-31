// うそつき六法の検査。index.html をブラウザで開き、見本の話の形と遊び方を確かめる。
// 使い方: node qa/run.mjs   失敗があれば終了コード 1。結果は qa-report/report.md。
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
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

  // 1. 話の一覧の形：各段12話・正しい話と間違った話の両方・条文は「名前：要点」
  const data = await page.evaluate(() => TALKS.map((t) => ({ id: t.id, lv: t.lv, ok: t.ok, say: t.say, law: t.law, why: t.why })));
  const ids = new Set(data.map((t) => t.id));
  check("話の id が重ならない", ids.size === data.length, `${data.length}話`);
  for (const lv of [1, 2, 3]) {
    const xs = data.filter((t) => t.lv === lv);
    check(`段${lv}に正しい話と間違った話がある`, xs.some((t) => t.ok) && xs.some((t) => !t.ok), `${xs.length}話`);
  }
  check("条文は「名前：要点」の形", data.every((t) => t.law.includes("：")));
  check("せりふは45字以内（一目で読める長さ）", data.every((t) => t.say.length <= 45), data.filter((t) => t.say.length > 45).map((t) => t.id).join(","));

  // 1b. 村の組み方：何回作っても4人そろい、正しい話・間違った話が両方入る（2026-10-31 段1で間違った話を使い切ると0人の村ができた）
  const villages = await page.evaluate(() => {
    const bad = []; const keep = { level, used: new Set(used), vno };
    for (const lv of [1, 2, 3]) { level = lv; used = new Set();
      for (let i = 0; i < 300; i++) { makeVillage(); const nf = people.filter((p) => !p.ok).length;
        if (people.length !== PER) bad.push({ size: true, msg: `段${lv}の${i}回目：${people.length}人` }); else if (nf < 1 || nf > 3) bad.push({ size: false, msg: `段${lv}の${i}回目：間違い${nf}人` }); } }
    level = keep.level; used = keep.used; vno = keep.vno; makeVillage(); render(); return bad;
  });
  const short = villages.filter((b) => b.size), skew = villages.filter((b) => !b.size);
  check("村を900回作っても毎回4人そろう", short.length === 0, short.slice(0, 3).map((b) => b.msg).join(" / "));
  check("村には正しい話と間違った話が両方入る（900回のうち95%以上）", skew.length <= 45, `${skew.length}回 偏った`);

  // 1c. 復習：見誤った話は出す日まで出さない・日付が変わったら前の日に出た話も復習に出す（2026-10-31 CodeRabbit の指摘）
  const rv = await page.evaluate(() => {
    const keep = { level, used: new Set(used), usedDay, vno, mem: localStorage.getItem(KEY) };
    const t = today(), wait = ["e2", "e7"]; const m = {}; wait.forEach((id) => (m[id] = t + DAY)); localStorage.setItem(KEY, JSON.stringify(m));
    let early = 0, short = 0; level = 1;
    for (let i = 0; i < 300; i++) { used = new Set(); makeVillage(); if (people.some((p) => wait.includes(p.id))) early++; if (people.length !== PER) short++; }
    localStorage.setItem(KEY, JSON.stringify({ e1: t - DAY })); used = new Set(["e1"]); usedDay = t - DAY; makeVillage();
    const nextDay = people.some((p) => p.id === "e1");
    level = keep.level; used = keep.used; usedDay = keep.usedDay; vno = keep.vno;
    if (keep.mem === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, keep.mem);
    makeVillage(); render(); return { early, short, nextDay };
  });
  check("見誤った話は出す日まで出ない（300回）", rv.early === 0 && rv.short === 0, `早く出た${rv.early}回・4人未満${rv.short}回`);
  check("日付が変わると、前の日に出た話も復習に出る", rv.nextDay);
  check("スマホ用の viewport がある", await page.evaluate(() => (document.querySelector('meta[name="viewport"]')?.content || "").includes("width=device-width")));

  // 2. 一問ずつ出る・ヒントは番号だけ・答えると条文が出る
  check("村人は1人ずつ出る", (await page.locator(".person").count()) === 1);
  await page.click(".flip");
  const hint = await page.textContent(".person .law");
  check("ヒントは条文の番号だけ", hint.startsWith("ヒント：") && !hint.includes("、") , hint);
  check("ヒントは村で1回だけ", await page.locator(".flip").isDisabled());

  // 3. 一晩（5村）を遊ぶ：全問正解で難しく、全問誤りで易しくなる
  const levels = [];
  for (let v = 0; v < 5; v++) {
    levels.push(await page.textContent("#vname"));
    for (let k = 0; k < 4; k++) {
      const ok = await page.evaluate(() => { const s = document.querySelector(".person .say").textContent.slice(1, -1); return TALKS.find((t) => t.say === s).ok; });
      const pick = v === 2 ? !ok : ok;
      await page.click(`.vote[data-m="${pick ? "o" : "x"}"]`);
      if (k === 0) check(`第${v + 1}の村：答えると条文と解説が出る`, (await page.locator(".person .law").count()) === 2);
      await page.click("#next");
    }
    await page.click("#next");
    if (v === 0) check("次の村へ進むと、前の村のまとめは消える", await page.locator("#result").isHidden());
  }
  check("全問正解で次の村が難しくなる", levels[0].includes("★☆☆") && levels[1].includes("★★☆") && levels[2].includes("★★★"), levels.join(" / "));
  check("全問誤りで次の村が易しくなる", levels[3].includes("★★☆"), levels[3]);

  // 4. 見誤った話は翌日以降に出す日が記録される
  const mem = await page.evaluate(() => JSON.parse(localStorage.getItem("roppo-village-v1") || "{}"));
  check("見誤った話が記録される", Object.keys(mem).length >= 1, Object.keys(mem).join(","));

  // 4b. 応援のリンク：Ko-fi へのただのリンクだけ（外のスクリプトを読まず、遊ぶ人の記録を外へ送らない）
  const kofi = await page.locator("#kofi").evaluate((a) => ({ href: a.href, rel: a.rel })).catch(() => null);
  check("応援のリンクが Ko-fi のページを指す", kofi && kofi.href === "https://ko-fi.com/satouaaaaa", kofi?.href || "無い");
  check("応援のリンクは noopener つき", kofi && kofi.rel.includes("noopener"));
  check("外のスクリプトを読まない", (await page.locator("script[src]").count()) === 0);

  // 5. スマホ幅で横にはみ出さない・エラーが出ない
  check("スマホ幅で横にはみ出さない", (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  check("ページのエラーが無い", errors.length === 0, errors.join(" / "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
const md = ["# QA うそつき六法", "", ...results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? `（${r.detail}）` : ""}`), "", failed.length ? `❌ ${failed.length}件失敗` : "✅ 全部通った"].join("\n");
mkdirSync(path.join(root, "qa-report"), { recursive: true });
writeFileSync(path.join(root, "qa-report", "report.md"), md + "\n");
console.log(md);
process.exit(failed.length ? 1 : 0);
