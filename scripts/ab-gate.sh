#!/usr/bin/env bash
# Gate A/B de un comando (Etapa 0 — anillos de deploy).
#
# Compara el perfil AR entre el código que AR corre HOY (origin/main) y un CANDIDATO
# (la rama que querés promover), usando la DB real de AR de la rama origin/ar-data.
# Si el perfil AR cambia y NO debía, es una regresión → NO promover a AR.
#
# Uso:    scripts/ab-gate.sh [rama-candidata]      (default: la rama actual, HEAD)
# Ej:     scripts/ab-gate.sh feature/portugal-eur
#
# Requiere: macOS (qlmanage para el render del PDF) + Node 22. Corre local; no deploya nada.
set -euo pipefail

export PATH="$HOME/.local/node-v22.12.0-darwin-arm64/bin:$PATH"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAND_REF="${1:-HEAD}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/abgate-run-XXXXXX")"
cleanup() { git -C "$REPO" worktree remove --force "$WORK/golden" 2>/dev/null || true
            git -C "$REPO" worktree remove --force "$WORK/cand"   2>/dev/null || true
            git -C "$REPO" worktree prune 2>/dev/null || true
            rm -rf "$WORK"; }
trap cleanup EXIT

echo "→ fetch origin/main + origin/ar-data …"
git -C "$REPO" fetch -q origin main ar-data

# Resolver el sha del candidato ANTES de armar worktrees (acepta rama local o HEAD)
CAND_SHA="$(git -C "$REPO" rev-parse "$CAND_REF")"
GOLD_SHA="$(git -C "$REPO" rev-parse origin/main)"
echo "  golden  = origin/main ($(echo "$GOLD_SHA" | cut -c1-8))   [lo que AR corre hoy]"
echo "  candidato= $CAND_REF ($(echo "$CAND_SHA" | cut -c1-8))"

link_deps() {   # symlinks de node_modules/dist (el server y statements.mjs los necesitan)
  ln -sfn "$REPO/node_modules" "$1/node_modules"
  ln -sfn "$REPO/dashboard-app/node_modules" "$1/dashboard-app/node_modules"
  ln -sfn "$REPO/dashboard-app/dist" "$1/dashboard-app/dist"
}

git -C "$REPO" worktree add -q --detach "$WORK/golden" "$GOLD_SHA"; link_deps "$WORK/golden"
git -C "$REPO" worktree add -q --detach "$WORK/cand"   "$CAND_SHA"; link_deps "$WORK/cand"

git -C "$REPO" show origin/ar-data:db.json > "$WORK/ar-db.json"
echo "  DB real de AR: $(wc -c < "$WORK/ar-db.json" | tr -d ' ') bytes"
echo

echo "→ capturo golden (perfil AR del código deployado) …"
node "$REPO/scripts/ab-gate.mjs" capture --db "$WORK/ar-db.json" --server-dir "$WORK/golden" --out "$WORK/golden.json"
echo
echo "→ chequeo el candidato contra el golden …"
node "$REPO/scripts/ab-gate.mjs" check --db "$WORK/ar-db.json" --server-dir "$WORK/cand" --golden "$WORK/golden.json"
