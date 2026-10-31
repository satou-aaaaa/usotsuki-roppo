# AGENTS.md

<!-- AI エージェント共通の指示（Claude・Codex・Gemini・Copilot などが読む）。CLAUDE.md はこれを取り込むだけ。 -->

うそつき六法：夜の村をまわり、村人が話す法律が正しいか間違いかを見分ける学習ゲーム。単体の `index.html` を GitHub Pages で公開する。

## 準備（最初に一度）

```bash
bash scripts/setup.sh   # Node.js（版は .nvmrc）を確かめ、検査の依存とブラウザを入れる。何度実行してもよい
```

## push する前の確認

```bash
node qa/run.mjs   # 話の形・一問ずつの流れ・難しさの上下・復習の記録・スマホ幅・エラーを見る（CI の QA と同じ）
```

## このリポジトリの決まり

- 話（`index.html` の `TALKS`）は、satou-aaaaa/tenbin（天秤の書）で一次資料と照らし合わせた問題・解説から作る。新しく足すときも条文・判例を一次資料で確かめ、`law` に「条文名：要点」、`why` に答えの理由を書く。法律相談にしない。
- 一画面に一問。せりふは45字以内。条文は答え合わせのときだけ見せ、ヒントは条文の番号だけ（遊んだ人の感想で決めた）。
- 難しさは正解率8〜9割を狙う（段1〜3。村の4人を全部見分けたら上げ、半分以下なら下げる）。
- 画面に「人狼」という言葉や投票の仕組みを入れない。
- 機能を足す・直すたびに `qa/run.mjs` に検査を足す。乱数で組む部分（村の組み方など）は、1回遊ぶだけでなく何百回も作って毎回の結果を確かめる（2026-10-31 段の話を使い切ると0人の村ができた。shared-workflows `incidents/2026-10-31-roppo-empty-village.md`）。
- 応援は Ko-fi（https://ko-fi.com/satouaaaaa）へのただのリンクだけ。Ko-fi のボタン用スクリプトは入れない（外へ通信させない）。遊ぶのは無料のまま、有料版は置かない（GitHub Pages は売り買いが主目的のサイトに使えない）。
- 公開リポジトリなので、個人情報・鍵を入れない。記録は遊ぶ人のブラウザ（localStorage）にだけ置き、外へ送らない。

## 公開

- GitHub Pages は `main` のルート（`/`）を公開する。PR の QA と Secret scan が ✅ になると `automerge.yml` が自動でマージする。止めたいときは下書きにするか、ラベル「自動マージしない」を付ける。

## 共通のきまり

- PR の作り方・マージの仕方は satou-aaaaa/shared-workflows の `routines/pr.md`、全体のきまりは `routines/common.md` に従う。
- CI の部品は shared-workflows の共通部品を呼ぶ。リポジトリ側の .github/workflows には呼び出しと設定値だけを書く。
- Claude 以外の AI・人が作業するときは、shared-workflows の `routines/tool-map.md` と `routines/without-claude.md` を読む。
