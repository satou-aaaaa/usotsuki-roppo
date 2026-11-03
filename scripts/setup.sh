#!/usr/bin/env bash
# 開発の準備を1コマンドで行う。人も、どの AI も同じ手順で動かせるようにするためのもの。何度実行してもよい。
#   使い方: bash scripts/setup.sh   （Windows は Git Bash で）
# Claude Code のクラウドセッションでは .claude/settings.json の SessionStart フックが自動で呼ぶ。
# CI の Setup check（共通部品）が、まっさらな環境でこれが通るかを確かめる。
# ひな形: satou-aaaaa/shared-workflows の template/scripts/setup.sh。このリポジトリは検査（qa/）の Node.js だけ。
# ひな形の版: 3（上げたら写しの版も上げる。scripts/drift-check.mjs が古い写しを週次まとめに出す）
#   2: 依存は毎回 npm ci・ブラウザが無ければ止める・このシェルで要る操作（nvm use・export）を最後に出す（shared-workflows incidents/2026-11-03-setup-false-ready.md）
#   3: nvm.sh を --no-use で読む（.nvmrc の版が入っていないと、読んだだけで何も言わずに止まっていた。incidents/2026-11-04-setup-nvm-silent-stop.md）
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "✗ $*" >&2; exit 1; }
# 準備のあと、このシェルで打つ必要がある操作。1つでもあれば最後に「✓」を出さない
todo=()
# 環境変数を以後のコマンドに渡す。クラウドセッションは CLAUDE_ENV_FILE に書く。
# それ以外は子のプロセスから親のシェルを変えられないので、打つ操作として最後に出す
session_env() {
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then echo "export $1" >> "$CLAUDE_ENV_FILE"; else todo+=("export $1"); fi
}

npm_dir=qa

# --- Node.js（版は .nvmrc。nvm・fnm・mise・Volta などはこのファイルを読む）---
want=$(tr -dc '0-9' < .nvmrc)
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$want" ]; }
if ! node_ok; then
  # 版が足りず nvm があれば、.nvmrc の版を入れる（Claude Code のクラウドは /opt/nvm にある）
  NVM_DIR=${NVM_DIR:-$HOME/.nvm}; [ -s "$NVM_DIR/nvm.sh" ] || NVM_DIR=/opt/nvm
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    set +u; export NVM_DIR; . "$NVM_DIR/nvm.sh" --no-use; nvm install "$want" >/dev/null; set -u
    if node_ok; then
      # nvm の切り替えはこのスクリプトの中だけに効く（親のシェルは古い Node のまま）
      if [ -n "${CLAUDE_ENV_FILE:-}" ]; then session_env "PATH=\"$(dirname "$(command -v node)"):\$PATH\""; else todo+=("nvm use $want"); fi
    fi
  fi
fi
node_ok || fail "Node.js $want 以上が要る（今は $(node -v 2>/dev/null || echo なし)。https://nodejs.org/ か、nvm・fnm で .nvmrc の版を入れる）"

# npm の依存。毎回 lock から入れ直す（npm ci は node_modules を消して入れ直す。数秒で終わる）。
# 日付だけで飛ばすと、消えた・別の版に替わった node_modules を見逃す（v1 の穴）
(cd "$npm_dir" && npm ci --no-audit --no-fund)

# Playwright のブラウザ。検査は CHROMIUM_PATH があればそれを、無ければ Playwright の置き場のものを使う
if [ "${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}" = 1 ]; then
  # 取ってこない環境（Claude Code のクラウドなど）は、入っているものを探す。見つからなければ止める
  pre=${PW_PREINSTALLED:-/opt/pw-browsers/chromium}   # PW_PREINSTALLED は検査（check-setup-template.sh）用
  if [ -n "${CHROMIUM_PATH:-}" ]; then
    [ -x "$CHROMIUM_PATH" ] || fail "CHROMIUM_PATH=$CHROMIUM_PATH が動かせない（ブラウザの場所を直すか、unset CHROMIUM_PATH）"
  elif [ -x "$pre" ]; then
    session_env "CHROMIUM_PATH=$pre"
  else
    def=$(cd "$npm_dir" && node -e 'try{process.stdout.write(require("playwright").chromium.executablePath())}catch{}' 2>/dev/null || true)
    [ -n "$def" ] && [ -x "$def" ] || fail "使えるブラウザが無い（PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 で取ってこない設定）。CHROMIUM_PATH にブラウザの場所を入れるか、PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD を外して入れ直す"
  fi
else
  (cd "$npm_dir" && npx playwright install chromium)
fi

next="node qa/run.mjs"
if [ ${#todo[@]} -gt 0 ]; then
  echo "△ 準備はできた。ただし、このシェルで先に次を打つ（打たないと古い Node や別のブラウザで動く）:"
  printf '    %s\n' "${todo[@]}"
  echo "  そのあと: $next"
else
  echo "✓ 準備できた。次は: $next"
fi
