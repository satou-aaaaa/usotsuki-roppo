// 引き継ぎコード（transfer.js）の検査。各ゲームの qa/run.mjs から呼ぶ（正：shared-workflows の template/qa/transfer-check.mjs。そのまま写す）。
// 使い方:
//   import { checkTransfer } from "./transfer-check.mjs";
//   await checkTransfer({ browser, url, game: "kippu-10", sample: { "kippu-v1": JSON.stringify({...}) }, check, open });
//   - url: ゲームのページ（http://127.0.0.1:xxxx/ など）
//   - sample: 書き出す記録（data-keys に合うキー → 文字）。ゲームが読める形にしておく
//   - check(name, ok, detail): 結果を数える関数（qa/run.mjs のもの）
//   - open（なくてよい）: async (page) => {} 「引き継ぎ」の data-hk を押せる画面まで進める
// 見ること: 書き出し → 別の端末（新しい context）で QR の URL を開いて取り込み → 記録が同じ・前の記録は控えに残る・控えに戻せる、
//          写しまちがい・別のゲーム・知らないキー・HTML の印の文字・大きく膨らむコードは弾く、ボタンは高さ44px以上、エラーが出ない。
//          版10: 書き込みが失敗しても記録が消えない（取り込み・控えに戻す）・保存に失敗したままなら入れ替えない・
//                入れ替えの前に開いたタブが古い記録で上書きしない・コードの後ろに言葉が続いても読む・大きく膨らむコードは途中で広げるのをやめる。
// 待ち方の決まり: 読み込み・読み直しのあとに記録を比べるときは、決まった時間（300ms）で比べず settle()（記録が落ち着くまで待つ）を使う。
//   読み直しを起こす操作の結果は、その場で sessionStorage に書き、読み直しのあとに読む（重い PC・CI で揺れない。incidents/2026-11-07-transfer-check-flaky-under-load.md）
import { deflateRawSync } from "node:zlib";

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc36 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return ((c ^ 0xffffffff) >>> 0).toString(36); };
// 作り物のコード（検査で弾かれることを見る用）
export function fakeCode(obj) {
  const z = deflateRawSync(Buffer.from(JSON.stringify(obj)));
  return "HK1." + z.toString("base64url") + "." + crc36(z);
}

export async function checkTransfer({ browser, url, game, sample, check, open }) {
  const errors = [];
  const watch = (p) => { p.on("pageerror", (e) => errors.push(String(e))); return p; };
  const dump = (page) => page.evaluate((keys) => Object.fromEntries(Object.keys(localStorage).filter((k) => keys.includes(k)).sort().map((k) => [k, localStorage.getItem(k)])), Object.keys(sample));
  // ゲームが読み込みのあとに記録を書き直し終えるまで待つ（重いと 300ms では終わらず、戻す直前の記録と控えが食いちがう）
  const settle = async (page) => { let a = JSON.stringify(await dump(page)); for (let i = 0; i < 30; i++) { await page.waitForTimeout(100); const b = JSON.stringify(await dump(page)); if (b === a) return b; a = b; } return a; };
  const openBox = async (page) => {
    if (open) await open(page);
    const h = page.locator("[data-hk]").filter({ visible: true }).first();
    await h.click();
    await page.waitForSelector(".hk-box");
  };
  const sizes = async (page) => page.$$eval(".hk-box button, .hk-box label.hk-file", (bs) => bs.filter((b) => b.offsetParent).map((b) => [b.textContent, b.getBoundingClientRect().height]).filter(([, h]) => h < 44));

  // 1. 書き出す（端末A）
  const A = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const pa = watch(await A.newPage());
  await pa.goto(url);
  await pa.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, sample);
  await pa.reload();
  await pa.waitForTimeout(300);
  // ゲームが読み込みのときに記録を整えて書き直すことがあるので、整えたあとの記録と比べる
  const want = JSON.stringify(await dump(pa));
  await openBox(pa);
  await pa.waitForFunction(() => document.querySelector("#hk-code")?.value);
  const code = await pa.inputValue("#hk-code");
  check("引き継ぎ：コードの形", /^HK[01]\.[A-Za-z0-9_-]+\.[0-9a-z]+$/.test(code), code.slice(0, 40));
  check("引き継ぎ：QR が出る", await pa.waitForSelector("#hk-qr svg", { timeout: 3000 }).then(() => true, () => false));
  const small = await sizes(pa);
  check("引き継ぎ：ボタンは高さ44px以上", small.length === 0, JSON.stringify(small));
  // 版7：古いブラウザ向けの縮めないコード（HK0）に作り直せる。はじめから HK0（縮められないブラウザ）なら押せないので押さない（版10）
  if (/^HK0\./.test(code)) check("引き継ぎ：はじめから縮めないコードなら、作り直しは押せない", await pa.isDisabled("#hk-plain"));
  else {
    await pa.click("#hk-plain");
    check("引き継ぎ：古いブラウザ向けに縮めないコード（HK0）を作り直せる", await pa.waitForFunction(() => /^HK0\./.test(document.querySelector("#hk-code")?.value || ""), null, { timeout: 3000 }).then(() => true, () => false));
  }
  const code0 = await pa.inputValue("#hk-code");
  await pa.keyboard.press("Escape");
  check("引き継ぎ：Esc で閉じる", (await pa.locator(".hk-box").count()) === 0);

  // 2. 別の端末で QR の URL を開く（前の記録は控えに残る）
  const B = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const pb = watch(await B.newPage());
  await pb.goto(url);
  const firstKey = Object.keys(sample)[0];
  const before = { [firstKey]: "{}" };
  await pb.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, before);
  await pb.reload();
  await pb.waitForTimeout(300);
  const had = await dump(pb);
  // QR から新しく開いたとき（読み込みの中で #hk= を見る道）を確かめるため、いったん別のページへ出る
  await pb.goto("about:blank");
  await pb.goto(url + "#hk=" + code);
  await pb.waitForSelector("#hk-yes");
  await Promise.all([pb.waitForEvent("load"), pb.click("#hk-yes")]);
  await pb.waitForTimeout(300);
  check("引き継ぎ：取り込むと同じ記録になる", JSON.stringify(await dump(pb)) === want);
  check("引き継ぎ：取り込んだあと URL にコードが残らない", !pb.url().includes("#hk="), pb.url());
  check("引き継ぎ：取り込んだと知らせる", (await pb.locator(".hk-toast").count()) === 1);
  // 知らせは消えずに「控えに戻す」を出す（取り込んだ記録でゲームの画面が出なくても戻せるように。版4）
  const tu = await pb.$$eval("#hk-toast-undo, #hk-toast-close", (bs) => bs.map((b) => b.getBoundingClientRect().height));
  check("引き継ぎ：取り込んだ知らせに「控えに戻す」「閉じる」があり、44px以上", tu.length === 2 && tu.every((h) => h >= 44), JSON.stringify(tu));
  const bak = await pb.evaluate((g) => JSON.parse(localStorage.getItem("hk-backup:" + g) || "null"), game);
  check("引き継ぎ：前の記録を控えに残す", bak && JSON.stringify(Object.fromEntries(Object.entries(bak.d).sort())) === JSON.stringify(had));

  // 3. 知らせの「控えに戻す」→「やめる」で知らせが出直す（ほかに入口が無くても戻せる。版6）
  await pb.click("#hk-toast-undo");
  await pb.click("#hk-no");
  check("引き継ぎ：知らせの「控えに戻す」をやめると、知らせが出直す", (await pb.locator("#hk-toast-undo").count()) === 1);
  // 知らせの「控えに戻す」で前の記録に戻る（版5）→ 箱の「控えに戻す」をもう一度押すとまた入れ替わる
  await pb.click("#hk-toast-undo");
  await Promise.all([pb.waitForEvent("load"), pb.click("#hk-yes")]);
  await pb.waitForTimeout(300);
  const back1 = await dump(pb);
  check("引き継ぎ：知らせの「控えに戻す」で前の記録に戻せる", JSON.stringify(back1) === JSON.stringify(had), JSON.stringify(back1).slice(0, 80));
  await openBox(pb);
  await pb.click("#hk-undo");
  await Promise.all([pb.waitForEvent("load"), pb.click("#hk-yes")]);
  await pb.waitForTimeout(300);
  check("引き継ぎ：もう一度「控えに戻す」を押すと、取り込んだ記録にまた入れ替わる", JSON.stringify(await dump(pb)) === want);
  // 知らせは「閉じる」で消える（もう一度同じコードを取り込んで確かめる）
  await pb.goto("about:blank");
  await pb.goto(url + "#hk=" + code);
  await pb.waitForSelector("#hk-yes");
  await Promise.all([pb.waitForEvent("load"), pb.click("#hk-yes")]);
  await pb.waitForTimeout(300);
  await pb.click("#hk-toast-close");
  check("引き継ぎ：知らせは「閉じる」で消える", (await pb.locator(".hk-toast").count()) === 0);

  // 4. 弾くコード（貼り付けで）
  const bad = [
    ["写しまちがい", code.slice(0, 12) + (code[12] === "A" ? "B" : "A") + code.slice(13), "途中で変わって"],
    ["途中で切れた", code.slice(0, Math.floor(code.length / 2)), ""],
    ["別のゲーム", fakeCode({ g: game + "-other", v: 1, at: new Date().toISOString(), d: sample }), "別のゲーム"],
    ["知らないキー", fakeCode({ g: game, v: 1, at: new Date().toISOString(), d: { ...sample, "hk-backup:x": "1", "token": "x" } }), "このゲームの記録ではない"],
    ["新しい版", fakeCode({ g: game, v: 99, at: new Date().toISOString(), d: sample }), "新しい版"],
    ["大きく膨らむ", "HK1." + deflateRawSync(Buffer.alloc(20 * 1024 * 1024, 48)).toString("base64url") + "." + crc36(deflateRawSync(Buffer.alloc(20 * 1024 * 1024, 48))), "大きすぎ"],
    ["大きすぎる HK0", "HK0." + "A".repeat(6 * 1024 * 1024) + ".0", "大きすぎ"],
    ["HTML の印の文字", fakeCode({ g: game, v: 1, at: new Date().toISOString(), d: { [Object.keys(sample)[0]]: JSON.stringify({ x: "<img src=x onerror=alert(1)>" }) } }), "使わない文字"],
  ];
  // 箱を開くまでの操作（遊び方を閉じるなど）でゲームが記録を書くことがあるので、一度開いてから比べる
  await openBox(pb);
  await pb.keyboard.press("Escape");
  const keep = JSON.stringify(await dump(pb));
  for (const [name, c, word] of bad) {
    await openBox(pb);
    await pb.fill("#hk-in", c);
    await pb.click("#hk-go");
    await pb.waitForSelector(".hk-err:not([hidden])");
    const msg = await pb.textContent(".hk-err:not([hidden])");
    check(`引き継ぎ：${name}のコードを弾く`, (await pb.locator("#hk-yes").count()) === 0 && msg.includes(word), msg);
    await pb.keyboard.press("Escape");
  }
  check("引き継ぎ：弾いたあとも記録は元のまま", JSON.stringify(await dump(pb)) === keep);
  // 大きく膨らむコードは、広げきる前にやめる（展開したあとの大きさだけを見ると、タブが固まる。版10。sekai-jikoku #1 の CodeRabbit）
  const bomb = "HK1." + deflateRawSync(Buffer.alloc(200 * 1024 * 1024, 48)).toString("base64url") + "." + crc36(deflateRawSync(Buffer.alloc(200 * 1024 * 1024, 48)));
  const t0 = Date.now();
  const bombMsg = await pb.evaluate((c) => window.HK.decode(c).then(() => "ok", (e) => e.kind || "x"), bomb);
  check("引き継ぎ：200MB に膨らむコードも、広げきる前に「大きすぎ」で止める", bombMsg === "big" && Date.now() - t0 < 10000, `${bombMsg} ${Date.now() - t0}ms`);

  // 5. URL ごと貼ってもよい（ホーム画面のアプリで貼る人向け）
  await openBox(pb);
  await pb.fill("#hk-in", "引き継ぎ\n" + url + "#hk=" + code + "\n");
  await pb.click("#hk-go");
  check("引き継ぎ：URL ごと貼っても読める", await pb.waitForSelector("#hk-yes", { timeout: 3000 }).then(() => true, () => false));
  await pb.click("#hk-no");
  // コードの前後に言葉があっても読む（後ろに9語以上続くと読めなくなっていた。版10。tenkizu-yomi #25 の CodeRabbit）
  await openBox(pb);
  await pb.fill("#hk-in", "code: " + code + " please paste this into the game on your new phone thanks a lot");
  await pb.click("#hk-go");
  check("引き継ぎ：コードの後ろに言葉が続いても読める", await pb.waitForSelector("#hk-yes", { timeout: 3000 }).then(() => true, () => false));
  await pb.click("#hk-no");

  // 6. 縮めないコード（HK0）も、取り込むと同じ記録になる（形だけでなく中身まで。2026-11-07 akushitsu-miyaburi #1 の CodeRabbit）
  // 取り込む前に記録を変えておく（同じ記録のままだと、取り込みが効かなくても通る。版10。tenkizu-yomi #25 の CodeRabbit）
  await pb.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, before);
  await pb.reload();
  await pb.waitForTimeout(300);
  check("引き継ぎ：（HK0 の前）記録を変えた", JSON.stringify(await dump(pb)) !== want);
  await pb.goto("about:blank");
  await pb.goto(url + "#hk=" + code0);
  await pb.waitForSelector("#hk-yes");
  await Promise.all([pb.waitForEvent("load"), pb.click("#hk-yes")]);
  await pb.waitForTimeout(300);
  check("引き継ぎ：縮めないコード（HK0）でも、取り込むと同じ記録になる", JSON.stringify(await dump(pb)) === want);
  if (await pb.locator("#hk-toast-close").count()) await pb.click("#hk-toast-close");

  // 7. 記録の保存に失敗したままなら、古い記録のコードを作らず知らせる（版7。2026-11-07 mukashi-narabe #1 の CodeRabbit）
  const C = await browser.newContext({ viewport: { width: 375, height: 740 } });
  // transfer.js が見張りを付ける前の setItem を、印のキーだけ失敗するものにする（空きが足りない端末の代わり）
  await C.addInitScript(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (window.__hkFail === k) throw new DOMException("full", "QuotaExceededError"); return o.call(this, k, v); }; });
  const pc = watch(await C.newPage());
  await pc.goto(url);
  await pc.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, sample);
  await pc.reload();
  await pc.waitForTimeout(300);
  await pc.evaluate((k) => { window.__hkFail = k; try { localStorage.setItem(k, "{}"); } catch (e) { /* 失敗させる */ } }, firstKey);
  await openBox(pc);
  await pc.waitForTimeout(300);
  check("引き継ぎ：保存に失敗したままなら、コードを作らずに知らせる", (await pc.locator("#hk-stale").count()) === 1 && !(await pc.evaluate(() => document.querySelector("#hk-code")?.value || "")));
  await pc.keyboard.press("Escape");
  // 保存に失敗したままなら、入れ替えない（手元にだけある最新の記録が消える。版10。setsuden-kotsu #1・jitensha-rule #1 の CodeRabbit）
  await pc.evaluate((c) => { location.hash = "hk=" + c; }, code);
  await pc.waitForSelector("#hk-yes");
  await pc.click("#hk-yes");
  check("引き継ぎ：保存に失敗したままなら、入れ替えずに知らせる", await pc.waitForSelector(".hk-err:not([hidden])", { timeout: 3000 }).then(() => true, () => false) && (await pc.evaluate(() => sessionStorage.length)) === 0);
  await pc.keyboard.press("Escape");
  await C.close();

  // 8. 書き込みが失敗しても記録が消えない（版10。meirei-narabe #1・hyakunin-awase #1 の CodeRabbit）
  const D = await browser.newContext({ viewport: { width: 375, height: 740 } });
  // 印（sessionStorage の hk-fail）に書いた条件のときだけ setItem を失敗させる：値が取り込む記録と同じ・キーが控えの途中（hk-prev:）。then があれば、失敗の前にほかのタブの書き込み（then のキーと値）をまねる
  await D.addInitScript(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { const f = JSON.parse(sessionStorage.getItem("hk-fail") || "null"); if (this === localStorage && f && ((f.v != null && v === f.v) || (f.k && String(k).startsWith(f.k)))) { if (f.then) o.call(this, f.then[0], f.then[1]); throw new DOMException("full", "QuotaExceededError"); } return o.call(this, k, v); }; });
  const pd = watch(await D.newPage());
  await pd.goto(url);
  await pd.evaluate((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, before);
  await pd.reload();
  await pd.waitForTimeout(300);
  const dBefore = JSON.stringify(await dump(pd));
  // 取り込む記録にあるキーで失敗させる（無いキーだと何も失敗せず、検査が何も見ないまま通る。版11）
  const failKey = firstKey in JSON.parse(want) ? firstKey : Object.keys(JSON.parse(want))[0];
  const wantVal = JSON.parse(want)[failKey];
  await pd.evaluate((v) => sessionStorage.setItem("hk-fail", JSON.stringify({ v })), wantVal);
  await pd.evaluate((c) => { location.hash = "hk=" + c; }, code);
  await pd.waitForSelector("#hk-yes");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  check("引き継ぎ：取り込みの書き込みが失敗したら、記録は元のまま", wantVal !== undefined && JSON.stringify(await dump(pd)) === dBefore, JSON.stringify(await dump(pd)).slice(0, 80));
  // 入れ替えの番号（hk-sync:）を書けなければ入れ替えない（古いタブが上書きしうる。#252 の CodeRabbit）
  await pd.evaluate(() => sessionStorage.setItem("hk-fail", JSON.stringify({ k: "hk-sync:" })));
  await pd.evaluate((c) => { location.hash = "hk=" + c; }, code);
  await pd.waitForSelector("#hk-yes");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  check("引き継ぎ：入れ替えの番号を書けなければ、記録は元のまま", JSON.stringify(await dump(pd)) === dBefore, JSON.stringify(await dump(pd)).slice(0, 80));
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  // 控えに戻す途中の書き込み（hk-prev:）が失敗したら、戻さない（いまの記録が消えない）
  await pd.evaluate(() => sessionStorage.removeItem("hk-fail"));
  await pd.evaluate((c) => { location.hash = "hk=" + c; }, code);
  await pd.waitForSelector("#hk-yes");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  const dNow = JSON.stringify(await dump(pd));
  await pd.evaluate(() => sessionStorage.setItem("hk-fail", JSON.stringify({ k: "hk-prev:" })));
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  await openBox(pd);
  await pd.click("#hk-undo");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  check("引き継ぎ：控えに戻す前の記録を書けなければ、戻さない（記録が消えない）", JSON.stringify(await dump(pd)) === dNow);
  await pd.evaluate(() => sessionStorage.removeItem("hk-fail"));
  // 途中で止まって残った戻す前の記録（hk-prev:）が壊れていたら使わず、いまの記録を控えにする（版11。nijushi-sekki #4 の CodeRabbit）
  const sorted = (d) => JSON.stringify(Object.fromEntries(Object.entries(d || {}).filter(([k]) => k in sample).sort()));
  // 入れ替えの番号（hk-sync:）は消さない（消すと、このタブは古いタブとみなされ、ここで書いた記録を捨てて読み直す）
  const putRec = (page, rec, extra) => page.evaluate(([s, x, g]) => { const n = localStorage.getItem("hk-sync:" + g); localStorage.clear(); if (n != null) localStorage.setItem("hk-sync:" + g, n); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v); }, [rec, extra, game]);
  await putRec(pd, before, { ["hk-backup:" + game]: JSON.stringify({ at: new Date().toISOString(), d: JSON.parse(want) }) });
  await pd.reload();
  await pd.waitForTimeout(300);
  await pd.evaluate((g) => localStorage.setItem("hk-prev:" + g, "{こわれた"), game);
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  await openBox(pd);
  await pd.click("#hk-undo");
  // ゲームは読み込みのあと記録を整えて書き直すので、戻す直前の記録と比べる
  const nb = await settle(pd);
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  const bk1 = await pd.evaluate((g) => { try { return JSON.parse(localStorage.getItem("hk-backup:" + g) || "null"); } catch (e) { return null; } }, game);
  check("引き継ぎ：残った戻す前の記録が壊れていても、控えに戻すと、いまの記録が控えに残る", JSON.stringify(await dump(pd)) === want && !!bk1 && sorted(bk1.d) === nb && (await pd.evaluate((g) => localStorage.getItem("hk-prev:" + g), game)) === null, JSON.stringify(bk1).slice(0, 80));
  // 途中で止まったあとに記録が変わっていたら、残った記録へ戻すときも、いまの記録を控えにする（版11。meirei-narabe #4 の CodeRabbit）
  // 控え（hk-backup:）の時刻は1時間前にする。同じ「いま」で2回作ると、ミリ秒が進んだとき控えのほうが新しくなり、空の控えへ戻って落ちた（sentaku-hyoji #3 の CodeRabbit）
  await putRec(pd, before, { ["hk-prev:" + game]: JSON.stringify({ at: new Date().toISOString(), d: JSON.parse(want) }), ["hk-backup:" + game]: JSON.stringify({ at: new Date(Date.now() - 3600e3).toISOString(), d: {} }), ["hk-prevfp:" + game]: "止まったときの印" });
  await pd.reload();
  await pd.waitForTimeout(300);
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  await openBox(pd);
  await pd.click("#hk-undo");
  const nb2 = await settle(pd);
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  const bk2 = await pd.evaluate((g) => JSON.parse(localStorage.getItem("hk-backup:" + g) || "null"), game);
  check("引き継ぎ：止まったあとに遊んだ記録は、残った記録へ戻しても控えに残る（上書きで消えない）", JSON.stringify(await dump(pd)) === want && !!bk2 && sorted(bk2.d) === nb2, JSON.stringify(bk2).slice(0, 80));
  // 控えの d が配列なら記録として使わない（「控えに戻す」を出さない。版12、dento-kogei #5 の CodeRabbit）
  await putRec(pd, before, { ["hk-backup:" + game]: JSON.stringify({ at: new Date().toISOString(), d: ["x"] }) });
  await pd.reload();
  await pd.waitForTimeout(300);
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  await openBox(pd);
  check("引き継ぎ：控えの中身が配列なら、「控えに戻す」を出さない", (await pd.locator("#hk-undo").count()) === 0);
  await pd.keyboard.press("Escape").catch(() => {});
  // 止まって戻す前の記録が残ったまま、別の記録を取り込んだら、「控えに戻す」はその取り込みの前の記録へ戻す（版11。akushitsu-miyaburi #4 の CodeRabbit）
  await putRec(pd, before, { ["hk-prev:" + game]: JSON.stringify({ at: new Date(Date.now() - 3600e3).toISOString(), d: {} }) });
  await pd.reload();
  await pd.waitForTimeout(300);
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  const nb3 = await settle(pd);
  await pd.evaluate((c) => { location.hash = "hk=" + c; }, code);
  await pd.waitForSelector("#hk-yes");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  await openBox(pd);
  await pd.click("#hk-undo");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  check("引き継ぎ：止まって残った記録があっても、あとで取り込んだら、控えに戻すとその前の記録になる", sorted(await dump(pd)) === sorted(JSON.parse(nb3)), JSON.stringify(await dump(pd)).slice(0, 80));
  // 入れ替えの番号は、入れ替えに失敗したら元に戻す（記録は変わらないのに、ほかのタブの保存が捨てられる。版11）
  await putRec(pd, before, {});
  await pd.reload();
  await pd.waitForTimeout(300);
  const s0 = await pd.evaluate((g) => localStorage.getItem("hk-sync:" + g), game);
  await pd.evaluate(() => sessionStorage.setItem("hk-fail", JSON.stringify({ k: "hk-backup:" })));
  await pd.evaluate((c) => { location.hash = "hk=" + c; }, code);
  await pd.waitForSelector("#hk-yes");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  await pd.evaluate(() => sessionStorage.removeItem("hk-fail"));
  check("引き継ぎ：控えを書けずに入れ替えなかったら、入れ替えの番号も元のまま", (await pd.evaluate((g) => localStorage.getItem("hk-sync:" + g), game)) === s0 && JSON.stringify(await dump(pd)) !== want);
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  // そのあいだにほかのタブが番号を進めていたら、戻さない（戻すと、そのタブの入れ替えの前に開いた古いタブが保存できる。版11。#259 の CodeRabbit）
  await pd.evaluate((g) => sessionStorage.setItem("hk-fail", JSON.stringify({ k: "hk-backup:", then: ["hk-sync:" + g, "ほかのタブ.1"] })), game);
  await pd.evaluate((c) => { location.hash = "hk=" + c; }, code);
  await pd.waitForSelector("#hk-yes");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  await pd.evaluate(() => sessionStorage.removeItem("hk-fail"));
  check("引き継ぎ：入れ替えに失敗しても、ほかのタブが進めた番号は戻さない", (await pd.evaluate((g) => localStorage.getItem("hk-sync:" + g), game)) === "ほかのタブ.1");
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  // 控えに戻す前に、前の止まったときの印（hk-prevfp:）を消す。古い印が残ると、次に止まったあとの記録を控えに残さないことがある（版11。#259 の CodeRabbit）
  await putRec(pd, before, { ["hk-backup:" + game]: JSON.stringify({ at: new Date().toISOString(), d: JSON.parse(want) }), ["hk-prevfp:" + game]: "前の印" });
  await pd.reload();
  await pd.waitForTimeout(300);
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  await pd.evaluate(() => sessionStorage.setItem("hk-fail", JSON.stringify({ k: "hk-backup:" })));
  await openBox(pd);
  await pd.click("#hk-undo");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  await pd.evaluate(() => sessionStorage.removeItem("hk-fail"));
  check("引き継ぎ：控えに戻すとき、前に止まったときの古い印を残さない", (await pd.evaluate((g) => localStorage.getItem("hk-prevfp:" + g), game)) === null);
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  // 止まったときの印が無い（書けなかった）まま残った記録へ戻すときは、控え（元の記録のただ1つの写しかもしれない）を上書きしない（版11。#259 の CodeRabbit）
  const b0 = JSON.stringify({ at: new Date(Date.now() - 3600e3).toISOString(), d: { [firstKey]: "前の控え" } });
  await putRec(pd, before, { ["hk-prev:" + game]: JSON.stringify({ at: new Date().toISOString(), d: JSON.parse(want) }), ["hk-backup:" + game]: b0 });
  await pd.reload();
  await pd.waitForTimeout(300);
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  await openBox(pd);
  await pd.click("#hk-undo");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  check("引き継ぎ：止まったときの印が無ければ、残った記録へ戻しても控えを上書きしない", JSON.stringify(await dump(pd)) === want && (await pd.evaluate((g) => localStorage.getItem("hk-backup:" + g), game)) === b0);
  if (await pd.locator("#hk-toast-close").count()) await pd.click("#hk-toast-close");
  // 入れ替えの前に開いていたタブは、古い記録で上書きしない（版10。sekai-jikoku #1・pikuto-yomi #1 の CodeRabbit）
  await pd.evaluate((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, before);
  await pd.reload();
  await pd.waitForTimeout(300);
  const old = watch(await D.newPage());
  // 知らせ（storage）が届かないタブの代わり：transfer.js より先に止める
  await old.addInitScript(() => window.addEventListener("storage", (e) => e.stopImmediatePropagation(), true));
  await old.goto(url);
  await old.waitForTimeout(300);
  await pd.evaluate((c) => { location.hash = "hk=" + c; }, code);
  await pd.waitForSelector("#hk-yes");
  await Promise.all([pd.waitForEvent("load"), pd.click("#hk-yes")]);
  await pd.waitForTimeout(300);
  await old.evaluate((kv) => { try { localStorage.setItem(kv[0], kv[1]); } catch (e) { /* なし */ } }, [firstKey, before[firstKey]]).catch(() => {});
  await old.waitForTimeout(300);
  check("引き継ぎ：入れ替えの前に開いたタブは、古い記録で上書きしない", JSON.stringify(await dump(pd)) === want, JSON.stringify(await dump(pd)).slice(0, 80));
  // 古いタブの保存を捨てたときは、帯で知らせる（読み直しが遅れても、黙って記録が消えない。版11、meirei-narabe #4 の CodeRabbit）
  const old2 = watch(await D.newPage());
  await old2.addInitScript(() => window.addEventListener("storage", (e) => e.stopImmediatePropagation(), true));
  await old2.goto(url);
  await old2.waitForTimeout(300);
  await pd.evaluate((g) => localStorage.setItem("hk-sync:" + g, "ほかのタブで入れ替えた." + Date.now()), game);
  // 帯を出すと同時に読み直しが始まるので、見た結果は読み直しても残る sessionStorage に書き、読み直しのあとに読む（重いと evaluate の返事より先に画面が消える）
  await old2.evaluate((k) => { try { localStorage.setItem(k, "{}"); } catch (e) { /* なし */ } const b = document.getElementById("hk-stale-tab"); sessionStorage.setItem("hk-qa-band", String(!!b && b.getAttribute("role") === "alert" && b.querySelector("button").getBoundingClientRect().height >= 44)); }, firstKey).catch(() => {});
  await old2.waitForLoadState("load").catch(() => {});
  await old2.waitForTimeout(300);
  const band = (await old2.evaluate(() => sessionStorage.getItem("hk-qa-band")).catch(() => null)) === "true";
  check("引き継ぎ：古いタブの保存を捨てたら、「保存できない・読み直して」の帯を出す（ボタンは44px以上）", band);
  await D.close();

  check("引き継ぎ：エラーが出ない", errors.length === 0, errors.join(" / "));
  await A.close();
  await B.close();
}
