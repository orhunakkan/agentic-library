#!/usr/bin/env bash
# Runs the CI workflow (.github/workflows/ci.yml) on this machine: the same
# jobs, the same steps in the same order, and the e2e job in the same container
# image. A pass stands in for a green CI run in the issue loop
# (docs/agents/issue-loop.md), so a step added to ci.yml belongs here too.
#
# A pass is recorded against the git tree of the working copy as it was tested,
# so the loop can check that the commit it pushed is the code that passed.
#
#   scripts/issue-loop/ci-local.sh            run it (also: pnpm ci:local)
#   scripts/issue-loop/ci-local.sh --passed <commit>
#                                             exit 0 if that commit's tree passed
set -euo pipefail

repo_root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo_root"

passed_dir=${XDG_STATE_HOME:-$HOME/.local/state}/issue-loop/$(basename "$repo_root")/ci-local-passed
database_url=${CI_LOCAL_DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/agentic_test}

die() {
  echo "ci-local: $*" >&2
  exit 1
}

step() { printf '\n==> %s\n' "$*"; }

# The tree a commit of the working copy would have now, untracked files
# included and ignored ones left out, without touching the real index.
working_tree() {
  local index
  index=$(mktemp)
  trap 'rm -f "$index"' RETURN
  cp "$(git rev-parse --git-path index)" "$index"
  GIT_INDEX_FILE=$index git add -A
  GIT_INDEX_FILE=$index git write-tree
}

if [[ ${1:-} == --passed ]]; then
  [[ -n ${2:-} ]] || die "--passed needs a commit"
  [[ -f $passed_dir/$(git rev-parse "$2^{tree}") ]]
  exit
fi
(($# == 0)) || die "unknown option: $1"

image=$(grep -m1 -oE 'mcr\.microsoft\.com/playwright:[^[:space:]]+' .github/workflows/ci.yml) ||
  die "no Playwright image found in .github/workflows/ci.yml"
pnpm_version=$(jq -r '.packageManager' package.json)
command -v docker >/dev/null || die "docker is not installed"
pg_isready -q -d "$database_url" || die "Postgres isn't reachable at $database_url (set CI_LOCAL_DATABASE_URL)"

tree=$(working_tree)
started=$(date +%s)

# ---------- job: checks ----------

step "checks: pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile
step "checks: biome ci"
pnpm exec biome ci .
step "checks: typecheck"
pnpm typecheck
step "checks: unit tests"
pnpm test
step "checks: audit"
pnpm audit

# ---------- job: e2e, in CI's container image ----------

# As this user, so build output and reports aren't left owned by root.
step "e2e: in $image"
docker run --rm --ipc=host --network host \
  --user "$(id -u):$(id -g)" \
  -e CI=true -e HOME=/tmp/ci-home -e DATABASE_URL="$database_url" -e PNPM_SPEC="$pnpm_version" \
  -v "$repo_root:$repo_root" -w "$repo_root" \
  "$image" bash -euo pipefail -c '
    mkdir -p "$HOME"
    npm install --global --silent --prefix "$HOME/npm" "$PNPM_SPEC"
    export PATH=$HOME/npm/bin:$PATH
    step() { printf "\n==> %s\n" "$*"; }
    step "e2e: database tests";  pnpm test:db
    step "e2e: voices";          pnpm voices:fetch en_GB-cori-medium
    step "e2e: end-to-end";      pnpm e2e
    step "e2e: dev smoke";       pnpm smoke:dev
  '

[[ $(working_tree) == "$tree" ]] || die "files changed while the run was going, so it doesn't count: run it again"
mkdir -p "$passed_dir"
touch "$passed_dir/$tree"
step "CI passed locally in $(( ($(date +%s) - started) / 60 )) min (tree $tree)"
