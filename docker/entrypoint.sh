#!/bin/sh
set -eu

node /app/bin/initRuntimeData.js
exec "$@"
