#!/bin/bash

# ==========================================
# Nekro-Webchat 交互式 Docker 部署脚本
# ==========================================

# 清屏增加交互友好度
clear
echo "=========================================="
echo "      Nekro-Webchat INSTALLER"
echo "=========================================="

# ----------------- 固定配置 -----------------
DOCKER_USER="hajiming"
IMAGE_NAME="${DOCKER_USER}/nekro-webchat:latest"
CONTAINER_NAME="nekro-webchat"
# --------------------------------------------

# 1. 交互式获取服务暴露端口
read -p "请输入要暴露的外部 HTTP 端口 (默认: 80): " HOST_PORT
HOST_PORT=${HOST_PORT:-80}

# 2. 交互式获取后端环境变量配置
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "-> 未发现 .env 文件，正从 .env.example 复制模板..."
        cp .env.example .env
    else
        touch .env
    fi
fi

echo ""
echo "--- 正在配置后端环境变量 (.env) ---"

# 读取或默认 SSE API 地址
current_url=$(grep "^NEKRO_SERVER_URL=" .env | cut -d'=' -f2-)
current_url=${current_url:-"http://172.17.0.1:8021"}
read -p "请输入 NA SSEAPI 地址 (当前/默认: $current_url): " NEW_URL
NEW_URL=${NEW_URL:-$current_url}

# 读取或默认 Access Key
current_key=$(grep "^NEKRO_ACCESS_KEY=" .env | cut -d'=' -f2-)
read -p "请输入 NA Access Key (当前/默认: $current_key): " NEW_KEY
NEW_KEY=${NEW_KEY:-$current_key}

# 更新或追加 .env 文件字段的函数
update_env() {
    local key=$1
    local value=$2
    if grep -q "^${key}=" .env; then
        perl -pi -e "s|^${key}=.*|${key}=${value}|" .env
    else
        echo "${key}=${value}" >> .env
    fi
}

# 自动生成随机的 JWT Secret
current_secret=$(grep "^WEBCHAT_JWT_SECRET=" .env | cut -d'=' -f2-)
if [ -z "$current_secret" ] || [ "$current_secret" = "nekro-webchat-change-me-in-production" ]; then
    echo "-> 正在生成 JWT Secret..."
    if command -v openssl &> /dev/null; then
        NEW_SECRET=$(openssl rand -hex 32)
    else
        NEW_SECRET=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1)
    fi
    update_env "WEBCHAT_JWT_SECRET" "$NEW_SECRET"
fi

update_env "NEKRO_SERVER_URL" "$NEW_URL"
update_env "NEKRO_ACCESS_KEY" "$NEW_KEY"

echo "-> 环境变量配置成功并已写入 .env 文件。"
echo ""

# ==========================================
# 开始 Docker 部署流程
# ==========================================

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "错误: 未找到 docker 命令，请先安装 Docker 容器引擎。"
    exit 1
fi

# 拉取最新镜像
echo "-> 正在从 Docker Hub 拉取最新镜像: ${IMAGE_NAME}..."
docker pull ${IMAGE_NAME}

# 停止并删除旧容器（如果存在）
if [ "$(docker ps -a -q -f name=${CONTAINER_NAME})" ]; then
    echo "-> 发现残留的同名容器，正在停止并删除旧容器..."
    docker stop ${CONTAINER_NAME}
    docker rm ${CONTAINER_NAME}
fi

# 确保必要的本地挂载目录存在
echo "-> 检查持久化挂载目录..."
mkdir -p ./data ./uploads

# 运行新容器
echo "-> 正在启动全新容器，映射外部端口为 ${HOST_PORT}..."
docker run -d \
  --name ${CONTAINER_NAME} \
  --restart unless-stopped \
  -p ${HOST_PORT}:80 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/uploads:/app/uploads" \
  -v "$(pwd)/.env:/app/.env" \
  ${IMAGE_NAME}

echo "=========================================="
echo "🎉 部署流程已全部执行完成！"
echo "容器当前运行状态:"
docker ps -f name=${CONTAINER_NAME}
echo "=========================================="
