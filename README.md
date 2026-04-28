# Nekro WebChat

<p align="center">
  <img src="doc/logo.png" alt="Nekro WebChat Logo" width="120" height="120">
</p>

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115.0+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18.2.0-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.2.0-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)


**Nekro WebChat** 是一款基于 **FastAPI** 和 **React** 构建的高级 Web 聊天客户端。该项目专为适配 **NekroAgent SSE 适配器 (SSE Adapter)** 设计，提供了即时通信、文件流式处理以及富文本代码渲染功能。

---

## ✨ 核心功能

- 👤 **账户管理与鉴权**
  - 支持标准的 JWT (JSON Web Token) 安全认证，具备注册、登录功能。
  - 用户可以高度定制个人头像、昵称，以及定制 AI 聊天伴侣的形象名称。
- 💬 **多场景会话模式**
  - **1v1 纯享对话**：提供专享的 AI 对话空间，自动绑定用户的独立 ChatKey。
  - **群组协同对话**：支持自由创建群聊，通过邀请链接让其他账号加入。在群聊中需要 @AI (如 `@NekroAgent`) 即可触发 AI 业务流响应。
- 🎨 **动态群聊头像**
  - 自动依据当前群成员拼接 1-9 宫格的动态群组头像。
- ⚡ **全双工 WebSocket 通信**
  - 保持低延迟、高响应的聊天信息双向同步。
- 📝 **极致的 Markdown 渲染**
  - 完整兼容标准 GFM（GitHub Flavored Markdown）语法。
  - 完美支持 **Mermaid** 数据可视化图表、**KaTeX** 数学公式排版、以及代码高亮提示。
- 📁 **高级媒体与文件管理**
  - 支持收发表情包、大文件，包含自动存储容量回收策略与防 iOS 设备限制的流式下载功能。

---

## 🛠️ 技术栈清单

### 后端 (Backend)
- **FastAPI**: 高性能的 API 框架
- **SQLAlchemy + aiosqlite**: 异步的本地 SQLite 数据库交互
- **uv (Astral)**: Python 快速依赖管理
- **Pillow**: 本地图像动态拼接

### 前端 (Frontend)
- **React 18**: 用户界面交互驱动
- **Vite**: 现代化快速前端开发服务器
- **react-markdown + Mermaid + KaTeX**: 全面的渲染支持

---

## 🚀 快速启动指引

### 1. 配置文件

复制 `.env.example` 到 `.env` 文件，按需调整对应的代理端点：
```bash
cp .env.example .env
```

主要变量释义：
- `NEKRO_SERVER_URL`: 对应的 Nekro SSE 代理端点 (例如 `http://localhost:8080`)
- `WEBCHAT_DATABASE_URL`: sqlite 存储路径 (例如 `sqlite+aiosqlite:///./data/webchat.db`)

### 2. 启动 Python 后端

我们推荐使用 `uv` 管理开发环境：
```bash
# 同步依赖包并初始化虚拟环境
uv sync

# 运行 FastAPI + Uvicorn 开发者端口
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
```

### 3. 启动 React 前端

```bash
cd frontend

# 安装依赖
npm install

# 运行前端
npm run dev
```

---

## 🐳 生产环境部署

### 🚀 一键部署 (推荐)
通过远程脚本一键运行交互式配置及部署：
```bash
sudo -E bash -c 'bash <(curl -sSL https://raw.githubusercontent.com/NekroAI/nekro-webchat/main/deploy.sh)'
```

---

### 使用本地交互式脚本安装

```bash
bash deploy.sh
```
该脚本会自动拉取 `hajiming/nekro-webchat` 官方最新镜像，并协助您交互式设置环境变量以及端口映射。

### 自行构建
```bash
docker build -t nekro-webchat:latest .

docker run -d -p 8080:80 \
  --name nekro-chat \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/uploads:/app/uploads" \
  nekro-webchat:latest
```
