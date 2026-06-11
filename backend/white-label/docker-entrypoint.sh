#!/bin/sh
set -e

# Self-heal the node_modules volume (see backend/platform/docker-entrypoint.sh
# for the core rationale: the volume persists across image rebuilds and only
# seeds on first creation, so a dependency change leaves the stale volume
# shadowing the freshly built node_modules).
#
# White-label has a SECOND staleness vector: the generated Prisma client also
# lives in node_modules, so a prisma/schema.prisma change leaves a stale client
# in the volume too. Both are stamped inside the volume and handled minimally:
#   - package-lock.json changed   -> npm ci  (its postinstall reruns prisma generate)
#   - only prisma/schema changed  -> prisma generate
# `npm ci` (not install) leaves the host-mounted lockfile untouched.
LOCK_NEED=$(md5sum package-lock.json | cut -d' ' -f1)
LOCK_HAVE=$(cat node_modules/.lockstamp 2>/dev/null || true)
SCHEMA_NEED=$(md5sum prisma/schema.prisma | cut -d' ' -f1)
SCHEMA_HAVE=$(cat node_modules/.prismastamp 2>/dev/null || true)

if [ "$LOCK_NEED" != "$LOCK_HAVE" ]; then
  echo "[entrypoint] package-lock.json changed since last install — running npm ci (regenerates prisma client)"
  npm ci
  echo "$LOCK_NEED" > node_modules/.lockstamp
  echo "$SCHEMA_NEED" > node_modules/.prismastamp
elif [ "$SCHEMA_NEED" != "$SCHEMA_HAVE" ]; then
  echo "[entrypoint] prisma/schema.prisma changed since last generate — running prisma generate"
  npx prisma generate
  echo "$SCHEMA_NEED" > node_modules/.prismastamp
fi

exec "$@"
