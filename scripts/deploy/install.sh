#!/bin/sh
# Installs or updates the deploy poller on the server, from a reviewed copy of scripts/deploy/. Run as root:
#
#   scp -r scripts/deploy mint:/tmp/folio-deploy-src
#   ssh -t mint 'sudo sh /tmp/folio-deploy-src/install.sh /tmp/folio-deploy-src && rm -r /tmp/folio-deploy-src'
#
# It is safe to run again: each step leaves what's already right alone. It creates the folio-deploy system user,
# copies poll.ts and decide.ts to /opt/folio-deploy (root-owned, so the poller can't change what runs), adds the one
# sudo rule the poller needs, and installs the systemd units. The timer starts only once the GitHub token is in
# /etc/credstore/github_token; until then it says how to put it there.
set -eu

src=${1:?usage: install.sh <directory holding poll.ts, decide.ts and the two units>}
for file in poll.ts decide.ts folio-deploy-poll.service folio-deploy-poll.timer; do
  [ -f "$src/$file" ] || { echo "install.sh: $src/$file is missing" >&2; exit 1; }
done
[ "$(id -u)" -eq 0 ] || { echo 'install.sh: run it as root (sudo)' >&2; exit 1; }

if ! id folio-deploy >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin folio-deploy
fi

install -d -o root -g root -m 0755 /opt/folio-deploy
install -o root -g root -m 0644 "$src/poll.ts" "$src/decide.ts" /opt/folio-deploy/
# Node reads the two files as ES modules, whatever it would guess.
printf '{ "type": "module" }\n' > /opt/folio-deploy/package.json
chmod 0644 /opt/folio-deploy/package.json

# The poller may run the deploy script, with an environment and a full SHA, and nothing else.
rule='folio-deploy ALL=(root) NOPASSWD: /usr/local/bin/agentic-library-deploy ^(dev|prod) [0-9a-f]{40}$'
printf '%s\n' "$rule" > /etc/sudoers.d/folio-deploy.new
chmod 0440 /etc/sudoers.d/folio-deploy.new
visudo -cf /etc/sudoers.d/folio-deploy.new >/dev/null
mv /etc/sudoers.d/folio-deploy.new /etc/sudoers.d/folio-deploy

install -o root -g root -m 0644 "$src/folio-deploy-poll.service" "$src/folio-deploy-poll.timer" /etc/systemd/system/
systemctl daemon-reload

install -d -o root -g root -m 0700 /etc/credstore
if [ -s /etc/credstore/github_token ]; then
  systemctl enable --now folio-deploy-poll.timer
  echo 'install.sh: the poller is installed and its timer is running (journalctl -u folio-deploy-poll -f)'
else
  echo 'install.sh: installed, but the timer waits for the GitHub token. Put it in place with:'
  echo "  sudo sh -c 'umask 077; cat > /etc/credstore/github_token'   (paste the token, then Enter and Ctrl-D)"
  echo '  sudo systemctl enable --now folio-deploy-poll.timer'
fi
