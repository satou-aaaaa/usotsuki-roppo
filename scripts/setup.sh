#!/usr/bin/env bash
# 開発の準備を1コマンドで行う。人も、どの AI も同じ手順で動かせるようにするためのもの。何度実行してもよい。
#   使い方: bash scripts/setup.sh   （Windows は Git Bash で）
# Claude Code のクラウドセッションでは .claude/settings.json の SessionStart フックが自動で呼ぶ。
# CI の Setup check（共通部品）が、まっさらな環境でこれが通るかを確かめる。
# ひな形: satou-aaaaa/shared-workflows の template/scripts/setup.sh。ゲームはそのまま写せば動く（npm_dir と next だけ、ちがえば書き換える）。
# ひな形の版: 12（上げたら写しの版も上げる。scripts/drift-check.mjs が古い写しを週次まとめに出す）
#   2: 依存は毎回 npm ci・ブラウザが無ければ止める・このシェルで要る操作（nvm use・export）を最後に出す（shared-workflows incidents/2026-11-03-setup-false-ready.md）
#   3: nvm.sh を --no-use で読む（.nvmrc の版が入っていないと、読んだだけで何も言わずに止まっていた。incidents/2026-11-04-setup-nvm-silent-stop.md）
#   4: ブラウザの場所はファイルかも見る（-x だけだとフォルダでも通った。2026-11-05 CodeRabbit が bunshi-tsukuri #1 で指摘）
#   5: 依存は lock と Node の版が同じで npm ls が通れば入れ直さない（QA の最中に npm ci が node_modules を消していた）・
#      渡すブラウザの場所を空白があっても切れないよう引用する・最後にブラウザを本当に起動してみる（Linux のライブラリ不足・
#      合わない版・ダウンロード後の CHROMIUM_PATH を見逃していた）・nvm use の前に nvm.sh を読み込む案内を出す（incidents/2026-11-07-game-template-review-gaps.md）
#   6: 埋める <> を無くし、そのまま写して動く形にした・Python の節は requirements.txt があるときだけ動く（写し残すと pip で止まっていた）・
#      NODE_ENV=production でも devDependencies（playwright）を入れる（2026-11-07 kikigaki-techo の Setup check・gogen-suiri #1 の CodeRabbit）
#   7: package.json に Playwright があるのに読み込めないときは止める（起動の試しを黙って飛ばし「✓」を出していた。2026-11-07 kotowaza-awase #1 の CodeRabbit）
#   8: 相対パスの CHROMIUM_PATH を絶対パスにしてから使う（起動の試しは npm_dir に移って動くので、相対だと別の場所を指していた。2026-11-07 dema-tashikame #1 の CodeRabbit）
#   9: 絶対パスにした CHROMIUM_PATH を以後のコマンド（QA）にも渡す（親のシェルには相対のまま残っていた。2026-11-07 dema-tashikame #1 の CodeRabbit）
#  10: .nvmrc の先頭の数字（メジャー版）だけを読む（22.11.0 が 22110 になっていた）・nvm install の失敗で止めて知らせる・
#      依存を使い回すのは QA と同じ import() で Playwright を読めるときだけ（ESM の入口が欠けても通っていた）・
#      2つ同時に動いても npm ci を重ねない（ロック）・Git Bash では CHROMIUM_PATH を Windows の形に直す（2026-11-07 shared-workflows #219）
#  11: 強制終了で残ったロックは、同じ機械で持ち主が動いていなければ外す（10分待って止まっていた。#259）
#  12: 起動の試しは package.json に書いた Playwright を先に使う・ブラウザの置き場も QA と同じ import() で探す・
#      古いロックは自分だけの名前へ移してから消す（2つ同時に外して新しいロックを消さない）・名札の無い1分より古いロックも外す・ほかの人の動いているプロセスのロックは外さない（各ゲームの PR の CodeRabbit、2026-11-07）
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "✗ $*" >&2; exit 1; }
runnable() { [ -f "$1" ] && [ -x "$1" ]; }   # 動かせるファイルか（フォルダも -x では通るので -f も見る）
# 準備のあと、このシェルで打つ必要がある操作。1つでもあれば最後に「✓」を出さない
todo=()
# 環境変数を以後のコマンドに渡す。クラウドセッションは CLAUDE_ENV_FILE に書く。
# それ以外は子のプロセスから親のシェルを変えられないので、打つ操作として最後に出す
session_env() {
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then echo "export $1" >> "$CLAUDE_ENV_FILE"; else todo+=("export $1"); fi
}
q() { printf '%q' "$1"; }   # シェルにそのまま貼れる形にする（空白のある場所で切れないように。版5）

npm_dir=qa   # package.json のあるフォルダ（ゲームは qa。ちがえば . などに書き換える）
[ -f "$npm_dir/package.json" ] || fail "$npm_dir/package.json が無い（scripts/setup.sh の npm_dir= を package.json のあるフォルダにする）"

# --- Node.js（版は .nvmrc。nvm・fnm・mise・Volta などはこのファイルを読む）---
want=$(sed -E -n 's/^[^0-9]*([0-9]+).*/\1/p' .nvmrc | head -n1)   # 22・v22・22.11.0 のどれでも 22（版10）
[ -n "$want" ] || fail ".nvmrc から Node の版を読めない（22 のように書く）"
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$want" ]; }
if ! node_ok; then
  # 版が足りず nvm があれば、.nvmrc の版を入れる（Claude Code のクラウドは /opt/nvm にある）
  NVM_DIR=${NVM_DIR:-$HOME/.nvm}; [ -s "$NVM_DIR/nvm.sh" ] || NVM_DIR=/opt/nvm
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # --no-use: 読んだ時点で .nvmrc の版に切り替えようとさせない（入っていないと 3 を返し、set -e で黙って止まる）
    set +u; export NVM_DIR; . "$NVM_DIR/nvm.sh" --no-use; nvm install "$want" >/dev/null || { set -u; fail "nvm install $want に失敗した（ネットにつながるか確かめる。https://github.com/nvm-sh/nvm#troubleshooting）"; }; set -u
    if node_ok; then
      # nvm の切り替えはこのスクリプトの中だけに効く（親のシェルは古い Node のまま）
      if [ -n "${CLAUDE_ENV_FILE:-}" ]; then session_env "PATH=\"$(dirname "$(command -v node)"):\$PATH\""; else todo+=(". $(q "$NVM_DIR/nvm.sh") && nvm use $want"); fi   # nvm はシェルの関数なので、先に読み込む（新しいシェルには無い。版5）
    fi
  fi
fi
node_ok || fail "Node.js $want 以上が要る（今は $(node -v 2>/dev/null || echo なし)。https://nodejs.org/ か、nvm・fnm で .nvmrc の版を入れる）"

# npm の依存。lock と Node の版が前に入れたときと同じで、入っている木が lock どおり（npm ls が通る）なら入れ直さない。
# 日付だけで飛ばすと、消えた・別の版に替わった node_modules を見逃す（v1 の穴）。npm ls はそれを見つける。
# 毎回 npm ci すると、QA の最中に node_modules を消して QA を落とす（版5）。QA を回している間は、このスクリプトを動かさない
stamp="$npm_dir/node_modules/.setup-stamp"
sum=$( { node -v; cat "$npm_dir/package-lock.json"; } | cksum )
# package.json にある Playwright を、QA と同じ import() で読めるか（require では ESM の入口 index.mjs の欠けが分からない。版10）
pw_loads() {
  (cd "$npm_dir" && node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const want = ["playwright", "playwright-core", "@playwright/test"].filter((m) => (pkg.dependencies || {})[m] || (pkg.devDependencies || {})[m]);
    for (const m of want) await import(m);
  ' >/dev/null 2>&1)
}
deps_ok() { [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$sum" ] && (cd "$npm_dir" && npm ls --all --include=dev >/dev/null 2>&1) && pw_loads; }
# 2つのセッションが同時に動いても npm ci を重ねない（片方が入れている node_modules をもう片方が消す。版10）
lock="$npm_dir/.setup-lock"
got=""
me="$(hostname 2>/dev/null || echo local) $$"
# 持ち主（同じ機械で、もう動いていない）が強制終了で残したロックだけを外す。別の機械のロックは外さない（版11の CodeRabbit）。
# 名札の無いロック（作った直後に止まった）は、1分より古ければ外す（版12）
# 動いているか。ほかの人のプロセスは kill -0 が「権限が無い」で失敗するので、それも動いているとみなす（版12、setsuden-kotsu #7 の CodeRabbit）
alive() { kill -0 "$1" 2>/dev/null && return 0; kill -0 "$1" 2>&1 | grep -qi 'not permitted'; }
stale() {
  local o
  if ! o=$(cat "$lock/owner" 2>/dev/null); then [ -d "$lock" ] && [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ] && echo "（名札なし）"; return; fi
  [ "${o% *}" = "${me% *}" ] && ! alive "${o##* }" && echo "$o"
}
# 外すときは、まず自分だけの名前へ移す（移せるのは1つだけ）。移したものが見たときと同じ持ち主のときだけ消し、ちがえば戻す。
# 2つの setup.sh が同じ古いロックを同時に外して、あとから取った新しいロックまで消すのを防ぐ（版12、shokuhin-hyoji #3 などの CodeRabbit）
reclaim() {
  local seen=$1 aside="$lock.gone.$$" now
  mv "$lock" "$aside" 2>/dev/null || return 0
  now=$(cat "$aside/owner" 2>/dev/null || echo "（名札なし）")
  if [ "$now" = "$seen" ]; then echo "前の setup.sh が残したロックを外す（$seen）"; rm -rf "$aside"; else mv "$aside" "$lock" 2>/dev/null || rm -rf "$aside"; fi
}
for _ in $(seq 1 600); do
  if mkdir "$lock" 2>/dev/null; then echo "$me" > "$lock/owner"; got=1; break; fi
  if o=$(stale) && [ -n "$o" ]; then reclaim "$o"; continue; fi
  sleep 1
done
[ -n "$got" ] || fail "$lock が10分消えない（ほかの setup.sh が止まったまま。動いていなければ rm -r $lock）"   # 取れなかったら進まない・人のロックを消さない
trap 'rm -f "$lock/owner"; rmdir "$lock" 2>/dev/null || true' EXIT
if deps_ok; then
  echo "依存は lock どおりに入っている（入れ直さない）"
else
  (cd "$npm_dir" && npm ci --include=dev --no-audit --no-fund)   # NODE_ENV=production でも検査の道具（devDependencies）を入れる（版6）
  echo "$sum" > "$stamp"
fi
rm -f "$lock/owner"; rmdir "$lock" 2>/dev/null || true
trap - EXIT   # 返したあとは、あとから来た setup.sh のロックを終わりに消さない

# Playwright のブラウザ。検査は CHROMIUM_PATH があればそれを、無ければ Playwright の置き場のものを使う
# 相対パスはここで絶対パスにする（起動の試しは "$npm_dir" に移って動く。Playwright は相対の executablePath をいまの場所から探す。版8）
if [ -n "${CHROMIUM_PATH:-}" ]; then
  case "$CHROMIUM_PATH" in /* | [A-Za-z]:*) ;; *) CHROMIUM_PATH="$PWD/$CHROMIUM_PATH"; export CHROMIUM_PATH; session_env "CHROMIUM_PATH=$(q "$CHROMIUM_PATH")" ;; esac   # 以後の QA にも絶対パスを渡す（版9）
  # Git Bash の /c/... の形は Node が読めないので C:/... にする（版10）
  if command -v cygpath >/dev/null && [ "${CHROMIUM_PATH#/}" != "$CHROMIUM_PATH" ]; then CHROMIUM_PATH=$(cygpath -m "$CHROMIUM_PATH"); export CHROMIUM_PATH; session_env "CHROMIUM_PATH=$(q "$CHROMIUM_PATH")"; fi
fi
if [ "${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}" = 1 ]; then
  # 取ってこない環境（Claude Code のクラウドなど）は、入っているものを探す。見つからなければ止める
  pre=${PW_PREINSTALLED:-/opt/pw-browsers/chromium}   # PW_PREINSTALLED は検査（check-setup-template.sh）用
  if [ -n "${CHROMIUM_PATH:-}" ]; then
    runnable "$CHROMIUM_PATH" || fail "CHROMIUM_PATH=$CHROMIUM_PATH が動かせない（ブラウザの場所を直すか、unset CHROMIUM_PATH）"
  elif runnable "$pre"; then
    session_env "CHROMIUM_PATH=$(q "$pre")"; export CHROMIUM_PATH="$pre"
  else
    # QA と同じ import() で探す（require では ESM の入口だけがあるとき見つからない。版12、kokoku-minuki #2 の CodeRabbit）
    def=$(cd "$npm_dir" && node --input-type=module -e 'for (const m of ["playwright", "playwright-core", "@playwright/test"]) { try { const pw = await import(m); const c = pw.chromium || (pw.default && pw.default.chromium); process.stdout.write(c.executablePath()); break; } catch {} }' 2>/dev/null || true)
    [ -n "$def" ] && runnable "$def" || fail "使えるブラウザが無い（PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 で取ってこない設定）。CHROMIUM_PATH にブラウザの場所を入れるか、PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD を外して入れ直す"
  fi
else
  if [ -n "${CHROMIUM_PATH:-}" ]; then
    runnable "$CHROMIUM_PATH" || fail "CHROMIUM_PATH=$CHROMIUM_PATH が動かせない（ブラウザの場所を直すか、unset CHROMIUM_PATH）"
  else
    (cd "$npm_dir" && npx playwright install chromium)
  fi
fi
# 本当に起動できるかを試す（Linux で足りないライブラリ・Playwright と合わないブラウザは、ここまでの検査では分からない。版5）。
# package.json に Playwright を書いていない（検査でブラウザを使わない）リポジトリでは試さない。
# 書いてあるのに読み込めないときは止める（入れ損ねたまま「✓」を出していた。版7）
if ! err=$(cd "$npm_dir" && node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const names = ["playwright", "playwright-core", "@playwright/test"];
  const pkg = JSON.parse(readFileSync("package.json", "utf8")), want = names.filter((m) => (pkg.dependencies || {})[m] || (pkg.devDependencies || {})[m]);
  // package.json に書いたものを先に試す（書いていない別の版が間接に入っていても、そちらで「✓」を出さない。版12、akushitsu-miyaburi #4 の CodeRabbit）
  let pw; for (const m of [...want, ...names.filter((n) => !want.includes(n))]) { try { pw = await import(m); break; } catch {} }   // QA と同じ import()（版10）
  if (!pw && want.length) { console.error("package.json に " + want.join("・") + " があるのに読み込めない（npm ci が入れ損ねた。node_modules を消して入れ直す）"); process.exit(1); }
  if (!pw) process.exit(0);
  const chromium = pw.chromium || (pw.default && pw.default.chromium);
  await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }).then((b) => b.close(), (e) => { console.error(String(e.message).split("\n").slice(0, 4).join("\n")); process.exit(1); });
' 2>&1); then
  hint="ブラウザの場所（CHROMIUM_PATH）を直す"
  [ "$(uname -s)" = Linux ] && hint="Linux なら足りないライブラリを sudo npx playwright install-deps chromium で入れる（Playwright Docs「Browsers」）か、$hint"
  fail "ブラウザを起動できない。$hint
$err"
fi

# --- Python（版は .python-version。pyenv・uv・mise などはこのファイルを読む）---
# requirements.txt が無いリポジトリ（ゲームなど）では何もしない（消し忘れても Setup check が落ちないように。2026-11-07 sagi-minuki）
if [ -f requirements.txt ]; then
  py=$(command -v python3 || command -v python || command -v py || true)
  [ -n "$py" ] || fail "Python $(cat .python-version) が要る（https://www.python.org/ ）"
  "$py" -m venv .venv
  if [ -x .venv/bin/python ]; then vbin=.venv/bin; else vbin=.venv/Scripts; fi   # Windows は Scripts
  "$vbin/python" -m pip install -q -r requirements.txt
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then session_env "PATH=\"$PWD/$vbin:\$PATH\""; else todo+=(". $vbin/activate"); fi
fi

next="node qa/run.mjs"   # push する前の確認コマンド（ちがえば書き換える）
if [ ${#todo[@]} -gt 0 ]; then
  echo "△ 準備はできた。ただし、このシェルで先に次を打つ（打たないと古い Node や別のブラウザで動く）:"
  printf '    %s\n' "${todo[@]}"
  echo "  そのあと: $next"
else
  echo "✓ 準備できた。次は: $next"
fi
