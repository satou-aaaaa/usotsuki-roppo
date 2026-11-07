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
  // 版7：古いブラウザ向けの縮めないコード（HK0）に作り直せる
  await pa.click("#hk-plain");
  check("引き継ぎ：古いブラウザ向けに縮めないコード（HK0）を作り直せる", await pa.waitForFunction(() => /^HK0\./.test(document.querySelector("#hk-code")?.value || ""), null, { timeout: 3000 }).then(() => true, () => false));
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

  // 5. URL ごと貼ってもよい（ホーム画面のアプリで貼る人向け）
  await openBox(pb);
  await pb.fill("#hk-in", "引き継ぎ\n" + url + "#hk=" + code + "\n");
  await pb.click("#hk-go");
  check("引き継ぎ：URL ごと貼っても読める", await pb.waitForSelector("#hk-yes", { timeout: 3000 }).then(() => true, () => false));
  await pb.click("#hk-no");

  // 6. 縮めないコード（HK0）も、取り込むと同じ記録になる（形だけでなく中身まで。2026-11-07 akushitsu-miyaburi #1 の CodeRabbit）
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
  await C.close();

  check("引き継ぎ：エラーが出ない", errors.length === 0, errors.join(" / "));
  await A.close();
  await B.close();
}
