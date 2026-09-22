#!/bin/sh
# OsyC 切版前一键门禁的 POSIX 入口。
# 真正的实现是 scripts/gate-all.mjs（跨平台，Windows 上可直接 node 运行）。
# 本包装只负责转发参数，保持与清单里 sh scripts/gate-all.sh 的写法兼容。
set -e
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$DIR/gate-all.mjs" "$@"
