#!/bin/sh
# Volumes Docker creates on first mount are root-owned regardless of the
# image's chown; fix that up before dropping to the unprivileged `node` user.
chown -R node:node /data 2>/dev/null
exec su-exec node "$@"
