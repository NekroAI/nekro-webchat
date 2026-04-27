#!/bin/bash

# 确保环境变量可用
export PATH="/app/.venv/bin:$PATH"

echo "=========================================="
echo " 正在启动 Python 后端..."
echo "=========================================="
# 使用 uv run 启动 uvicorn，绑定 127.0.0.1 供 Nginx 反向代理
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765 &

echo "=========================================="
echo " 正在启动 Nginx 服务..."
echo "=========================================="
# 启动 Nginx 作为前台进程，防止容器退出
nginx -g "daemon off;"
