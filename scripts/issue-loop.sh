#!/usr/bin/env bash
# Issue loop: builds "ready-for-agent" issues one at a time, each in a fresh
# Claude session, then runs a retro session on each build.
# Design and definition of done: docs/agents/issue-loop.md
#
#   scripts/issue-loop.sh start [--once]   start the loop in tmux and return
#   scripts/issue-loop.sh status           is it running, and its latest log
#   scripts/issue-loop.sh stop             stop after the current issue
#   scripts/issue-loop.sh run [--once]     the loop itself (what start runs)
#   scripts/issue-loop.sh run --dry-run    list the queue, start nothing
set -euo pipefail

repo_root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo_root"

here=$repo_root/scripts/issue-loop
label=ready-for-agent
tmux_session=issue-loop
state_dir=${XDG_STATE_HOME:-$HOME/.local/state}/issue-loop/$(basename "$repo_root")
stop_file=$state_dir/stop
sessions_dir=$HOME/.claude/projects/$(sed 's#[^A-Za-z0-9]#-#g' <<<"$repo_root")
session_timeout=${ISSUE_LOOP_SESSION_TIMEOUT:-3h}
max_budget=${ISSUE_LOOP_MAX_BUDGET_USD:-}

die() {
  echo "issue-loop: $*" >&2
  exit 1
}

# ---------- start / status / stop ----------

cmd_start() {
  command -v tmux >/dev/null || die "tmux is not installed"
  tmux has-session -t "$tmux_session" 2>/dev/null && die "already running: tmux attach -t $tmux_session"
  rm -f "$stop_file"
  local args
  args=$(printf '%q ' "$@")
  # systemd-inhibit keeps the machine from idling or suspending while the loop runs.
  # The pane stays open after the loop ends, so its summary can still be read.
  tmux new-session -d -s "$tmux_session" -c "$repo_root" \
    "systemd-inhibit --what=idle:sleep --who=issue-loop --why='Building GitHub issues' $(printf '%q' "$repo_root/scripts/issue-loop.sh") run $args; echo; read -rp 'Loop ended. Press Enter to close. '"
  echo "Started. Watch it: tmux attach -t $tmux_session (detach: Ctrl-b d)"
  echo "Stop after the current issue: scripts/issue-loop.sh stop"
}

cmd_status() {
  if tmux has-session -t "$tmux_session" 2>/dev/null; then
    echo "Running in tmux session '$tmux_session'."
  else
    echo "Not running."
  fi
  [[ -f $stop_file ]] && echo "A stop is requested: it ends after the current issue."
  local latest
  latest=$(ls -1d "$state_dir"/runs/* 2>/dev/null | tail -1 || true)
  [[ -n $latest ]] || return 0
  echo "Latest run: $latest"
  tail -n 15 "$latest/loop.log"
}

cmd_stop() {
  mkdir -p "$state_dir"
  touch "$stop_file"
  echo "The loop will stop after the current issue."
}

# ---------- the loop ----------

# Logs go to stderr (and the run's log file), so functions can still return values on stdout.
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$run_dir/loop.log" >&2; }

preflight() {
  local tool
  for tool in claude gh git jq timeout; do
    command -v "$tool" >/dev/null || die "$tool is not installed"
  done
  gh auth status >/dev/null 2>&1 || die "gh is not logged in: gh auth login"
  [[ $(git branch --show-current) == main ]] || die "not on main"
  [[ -z $(git status --porcelain) ]] || die "the working tree has changes: commit or stash them first"
  git fetch -q origin main
  git merge -q --ff-only origin/main || die "main has diverged from origin/main"
  if [[ -z ${DATABASE_URL:-} ]] && command -v pg_isready >/dev/null &&
    ! pg_isready -q -h 127.0.0.1 -p 5432; then
    log "warning: Postgres isn't reachable at 127.0.0.1:5432, so pnpm test:db will fail"
  fi
}

# An issue is blocked while a native "blocked by" dependency, or an issue named
# on a "Blocked by:" line in its body, is still open.
is_blocked() {
  local n=$1 open ref
  open=$(gh api "repos/{owner}/{repo}/issues/$n" -q '.issue_dependencies_summary.blocked_by // 0')
  ((open > 0)) && return 0
  for ref in $(gh issue view "$n" --json body -q .body | grep -m1 -i '^blocked by:' | grep -oE '#[0-9]+' | tr -d '#'); do
    [[ $(gh issue view "$ref" --json state -q .state) == OPEN ]] && return 0
  done
  return 1
}

# Oldest open, unassigned, unblocked "ready-for-agent" issue not skipped this run.
# An assigned one was claimed by an earlier session that didn't finish: left for the owner.
next_issue() {
  local n
  for n in $(gh issue list --label "$label" --state open --search 'no:assignee' --limit 200 \
    --json number -q '.[].number' | sort -n); do
    [[ " ${skipped[*]} " == *" $n "* ]] && continue
    is_blocked "$n" && continue
    echo "$n"
    return
  done
}

# fill <template> KEY=value...: the template with each {{KEY}} replaced.
fill() {
  local text pair
  text=$(<"$1")
  shift
  for pair in "$@"; do
    text=${text//"{{${pair%%=*}}}"/"${pair#*=}"}
  done
  printf '%s' "$text"
}

# run_claude <out.json> <settings.json> <system prompt> <prompt> [extra flags...]
run_claude() {
  local out=$1 settings=$2 system=$3 prompt=$4
  shift 4
  local budget=()
  [[ -n $max_budget ]] && budget=(--max-budget-usd "$max_budget")
  timeout "$session_timeout" claude -p "$prompt" \
    --output-format json --permission-mode dontAsk --settings "$settings" \
    --append-system-prompt "$system" "${budget[@]}" "$@" \
    >"$out" 2>"${out%.json}.stderr"
}

result_line() { jq -r '.result // ""' "$1" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -1; }

# check_done <n>: the definition of done (docs/agents/issue-loop.md), checked
# on GitHub rather than trusted from the session. Prints the commit on success.
check_done() {
  local n=$1 sha run_id tries=0
  git fetch -q origin main
  sha=$(git log origin/main -E --grep="Closes #$n([^0-9]|$)" --format=%H -1)
  [[ -n $sha ]] || { log "  not done: no commit with 'Closes #$n' on origin/main"; return 1; }
  [[ -z $(git status --porcelain) ]] || { log "  not done: the working tree has uncommitted changes"; return 1; }
  [[ $(git rev-parse HEAD) == $(git rev-parse origin/main) ]] || { log "  not done: local main and origin/main differ"; return 1; }
  [[ $(gh issue view "$n" --json state -q .state) == CLOSED ]] || { log "  not done: #$n is still open"; return 1; }
  until run_id=$(gh run list --workflow ci.yml --commit "$sha" --limit 1 --json databaseId -q '.[0].databaseId // empty') && [[ -n $run_id ]]; do
    ((++tries > 20)) && { log "  not done: no CI run found for $sha"; return 1; }
    sleep 15
  done
  gh run watch "$run_id" --exit-status >/dev/null 2>&1 || { log "  not done: CI run $run_id for $sha is not green"; return 1; }
  echo "$sha"
}

build_issue() {
  local n=$1 out=$run_dir/issue-$n-build.json base line status
  base=$(git rev-parse HEAD)
  log "#$n: $(gh issue view "$n" --json title -q .title)"
  log "#$n: Session A (build) started"
  if ! run_claude "$out" "$here/build-settings.json" \
    "$(fill "$here/build-prompt.md" ISSUE="$n" BASE_SHA="$base")" \
    "/mattpocock-skills:implement #$n"; then
    log "#$n: Session A exited with an error or timed out ($session_timeout); see ${out%.json}.stderr"
  fi
  build_session=$(jq -r '.session_id // empty' "$out" 2>/dev/null || true)
  log "#$n: Session A ended: session $build_session, cost \$$(jq -r '.total_cost_usd // "?"' "$out" 2>/dev/null)"
  line=$(result_line "$out")
  log "#$n: it says: ${line:-<nothing>}"

  case $line in
  "DONE #$n"*)
    if build_commit=$(check_done "$n"); then status=done; else status=failed; fi
    ;;
  "BLOCKED #$n"*)
    status=blocked
    if [[ -n $(git status --porcelain) ]]; then
      log "#$n: blocked, but it left uncommitted changes"
      status=failed
    elif gh issue view "$n" --json labels -q '.labels[].name' | grep -qx "$label"; then
      gh issue edit "$n" --remove-label "$label" --add-label needs-info >/dev/null
      log "#$n: moved the label to needs-info, since the session didn't"
    fi
    ;;
  *) status=failed ;;
  esac
  build_status=$status
}

retro_issue() {
  local n=$1 out=$run_dir/issue-$n-retro.json
  log "#$n: Session B (retro) started"
  if ! run_claude "$out" "$here/retro-settings.json" \
    "$(fill "$here/retro-prompt.md" ISSUE="$n" SESSION_ID="$build_session" \
      SESSION_LOG="$sessions_dir/$build_session.jsonl" COMMIT="$build_commit")" \
    "/mattpocock-skills:retro session $build_session (issue #$n)" \
    --add-dir "$sessions_dir"; then
    log "#$n: Session B exited with an error; the issue still counts as done"
  fi
  log "#$n: retro says: $(result_line "$out")"
}

cmd_run() {
  local once=false dry_run=false arg n
  for arg in "$@"; do
    case $arg in
    --once) once=true ;;
    --dry-run) dry_run=true ;;
    *) die "unknown option: $arg" ;;
    esac
  done

  run_dir=$state_dir/runs/$(date +%Y%m%dT%H%M%S)
  mkdir -p "$run_dir"
  skipped=()
  local done_list=() blocked_list=() failed=""

  if $dry_run; then
    log "Dry run. Queue, oldest first (unassigned, open, label $label):"
    for n in $(gh issue list --label "$label" --state open --search 'no:assignee' --limit 200 \
      --json number -q '.[].number' | sort -n); do
      if is_blocked "$n"; then log "  #$n (blocked, would wait)"; else log "  #$n $(gh issue view "$n" --json title -q .title)"; fi
    done
    return
  fi

  preflight
  log "Loop started. Logs: $run_dir"
  while true; do
    if [[ -f $stop_file ]]; then
      rm -f "$stop_file"
      log "Stop requested, so stopping."
      break
    fi
    n=$(next_issue)
    [[ -n $n ]] || { log "No more issues to build."; break; }

    build_session="" build_commit="" build_status=""
    build_issue "$n"
    case $build_status in
    done)
      log "#$n: DONE (commit $build_commit, CI green, issue closed)"
      done_list+=("$n")
      retro_issue "$n"
      ;;
    blocked)
      log "#$n: BLOCKED, skipping to the next issue"
      blocked_list+=("$n")
      skipped+=("$n")
      ;;
    *)
      log "#$n: FAILED, so the loop stops here. Session log: $sessions_dir/$build_session.jsonl"
      failed=$n
      break
      ;;
    esac
    $once && { log "--once given, so stopping."; break; }
  done

  log "Summary: done ${done_list[*]:-none} | blocked ${blocked_list[*]:-none} | failed ${failed:-none}"
  command -v notify-send >/dev/null && notify-send "Issue loop ended" \
    "Done: ${done_list[*]:-none}. Blocked: ${blocked_list[*]:-none}. Failed: ${failed:-none}." || true
  [[ -z $failed ]]
}

case ${1:-} in
start) shift; cmd_start "$@" ;;
status) cmd_status ;;
stop) cmd_stop ;;
run) shift; cmd_run "$@" ;;
*) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
