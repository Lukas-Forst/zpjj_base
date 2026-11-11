#!/usr/bin/env bash
# Design rules (docs/design.md): fail on emoji, shadows, gradients, large radii, hex colors in components.
cd "$(dirname "$0")/.." || exit 1
src="app components lib/timer lib/format.ts lib/tiles.ts styles"
fail=0
check() { # name, pattern, extra grep args...
  local name=$1 pat=$2; shift 2
  if out=$(grep -rnP "$pat" $src --include=*.ts --include=*.tsx --include=*.css "$@"); then
    echo "design check failed: $name"; echo "$out"; fail=1
  fi
}
check "emoji" '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B50}\x{23E9}-\x{23FF}]'
check "shadow/gradient" 'shadow|gradient'
check "radius > 2px" 'rounded-(md|lg|xl|2xl|3xl)\b|border-radius'
check "rounded-full outside avatar" 'rounded-full' --exclude-dir=ui
check "hex color in component" '#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b' --exclude=tokens.css --exclude=layout.tsx --exclude-dir=dev
exit $fail
