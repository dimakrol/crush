#!/bin/sh
set -e

# Self-heal the node_modules volume.
#
# In dev, source is bind-mounted over /app and node_modules lives in a separate
# volume so the container's Linux install isn't shadowed by the host's
# macOS/arm64 copy. That volume persists across image rebuilds and only seeds
# on first creation — so after a dependency change the stale volume shadows the
# freshly built node_modules ("Cannot find module ..."). Here we compare
# package-lock.json against a stamp written inside the volume and re-run
# `npm ci` only when it changed: cheap (one md5sum) on the common no-change
# path, correct on a dep bump. `npm ci` (not install) leaves the host-mounted
# lockfile untouched.
NEED=$(md5sum package-lock.json | cut -d' ' -f1)
HAVE=$(cat node_modules/.lockstamp 2>/dev/null || true)
if [ "$NEED" != "$HAVE" ]; then
  echo "[entrypoint] package-lock.json changed since last install — running npm ci"
  npm ci
  echo "$NEED" > node_modules/.lockstamp
fi

exec "$@"
