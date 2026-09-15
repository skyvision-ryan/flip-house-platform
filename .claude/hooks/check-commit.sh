#!/bin/bash
# 兼容旧 settings.json 配置：转发给 python 版守卫（真正的逻辑在 check_commit.py）
exec python3 "$(dirname "$0")/check_commit.py"
