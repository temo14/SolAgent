#!/usr/bin/env bash
set -euo pipefail

# Run from repo root: cd ~/sol-agent && bash scripts/export-sources.sh [output.txt]
ROOT="$(pwd)"
OUT="${1:-${ROOT}/solagent-full-sources.txt}"

collect_paths() {
  # App + shared + services (TypeScript / frontend / Prisma)
  find "$ROOT/app/src" \
       "$ROOT/shared" \
       "$ROOT/services" \
       -type f \( \
         -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
         -o -name '*.css' -o -name '*.prisma' \
       \) \
       ! -path '*/node_modules/*' \
       ! -path '*/dist/*' \
       ! -path '*/.git/*' \
       2>/dev/null || true

  # Root env files (adjust if you want to exclude secrets)
  find "$ROOT" -maxdepth 1 -type f \( -name '.env' -o -name '.env.*' \) 2>/dev/null || true

  # Docker
  find "$ROOT" -type f \( -name 'docker-compose.yml' -o -name 'docker-compose.yaml' \
       -o -name 'docker-compose.*.yml' -o -name 'docker-compose.*.yaml' \
       -o -name 'Dockerfile' -o -name 'Dockerfile.*' \) \
       ! -path '*/node_modules/*' \
       2>/dev/null || true

  # All package.json (workspaces), excluding node_modules
  find "$ROOT" -type f -name 'package.json' \
       ! -path '*/node_modules/*' \
       2>/dev/null || true

  # Anchor Rust programs
  if [[ -d "$ROOT/programs" ]]; then
    find "$ROOT/programs" -type f -name '*.rs' \
         ! -path '*/target/*' \
         2>/dev/null || true
  fi
}

{
  echo "=== SolAgent source export ==="
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Root: $ROOT"
  echo

  collect_paths | sort -u
} | while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  [[ "$f" == *"SolAgent source export"* ]] && continue
  [[ "$f" == *"Generated:"* ]] && continue
  [[ "$f" == *"Root:"* ]] && continue
  [[ ! -f "$f" ]] && continue

  echo
  echo "################################################################################"
  echo "# FILE: ${f#$ROOT/}"
  echo "################################################################################"
  cat "$f"
  echo
done > "$OUT"

echo "Wrote: $OUT"