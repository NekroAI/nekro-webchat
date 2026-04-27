# ==========================================
# 阶段 1: 构建前端
# ==========================================
FROM node:20-slim AS frontend-builder

WORKDIR /frontend

# 复制前端依赖定义
COPY frontend/package*.json ./

# 安装依赖
RUN npm ci

# 复制前端源码
COPY frontend/ ./

# 构建前端
RUN npm run build

# ==========================================
# 阶段 2: 最终运行镜像
# ==========================================
FROM python:3.11-slim-bookworm

# 安装 Nginx
RUN apt-get update && apt-get install -y \
    nginx \
    && rm -rf /var/lib/apt/lists/*

# 删除 Nginx 默认站点配置以防冲突
RUN rm -f /etc/nginx/sites-enabled/default

# 安装 uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# 复制后端依赖定义文件
COPY pyproject.toml uv.lock README.md ./

# 安装后端依赖
RUN uv sync --frozen --no-cache

# 复制后端应用代码
COPY app/ /app/app/
COPY static/ /app/static/

# 复制前端构建产物到 Nginx 默认目录
COPY --from=frontend-builder /frontend/dist /usr/share/nginx/html

# 复制 Nginx 配置文件
COPY nginx.conf /etc/nginx/nginx.conf

# 复制启动脚本
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# 创建持久化目录
RUN mkdir -p /app/data /app/uploads

# 暴露 Nginx 端口
EXPOSE 80

# 启动容器
CMD ["/app/start.sh"]
