# <img src="doc/logo.png" width="40" height="40" style="vertical-align: middle; margin-right: 8px;" /> Nekro WebChat

Nekro WebChat 是一个为 NekroAgent 量身定制的、基于 SSE（Server-Sent Events）适配器协议开发的现代网页聊天客户端。

## 核心特性

- 深度协议集成：底层基于 nekro-agent-sse-sdk 设计，完美贴合网关通信标准。
- 动态隔离存储：智能识别附件属性并根据流媒体类别与物理日期执行持久化隔离。
- 复合文档预览：支持 Markdown 排版表格渲染、HTML 沙盒执行以及纯文本源码的精准着色。
- 无状态轮询缓存：配合 SQLite 本地记录链，防止网络波动引发的重连闪断损失。

## 部署与启动

此项目采用前后端分离架构，启动步骤如下：

### 1. 后端主控服务 (FastAPI)

```bash
# 同步安装环境依赖
uv sync

# 复制并配置环境变量
copy .env.example .env

# 启动核心逻辑服务
uv run uvicorn app.main:app --host 127.0.0.1 --port 8765
```

### 2. 前端用户界面 (Vite / React)

```bash
# 导航至前端沙盒目录
cd frontend

# 加载 Node 依赖包
npm install

# 打开前端构建管道
npm run dev
```

运行成功后，可通过以下入口进行交互测试：
- 前端调试地址（推荐）：`http://127.0.0.1:5173`
- 后端服务接口：`http://127.0.0.1:8765`


## 基础配置索引

### 账号绑定 ChatKey
系统不再使用全局 `webchat_main`。每个登录账号会自动生成并绑定自己的稳定网关路由：
```text
sse-webchat-webchat_user_<账号ID>
```

### 归档存储快照
持久化事务日志、用户轨迹以及会话模型落盘节点位于：
```text
data/webchat.db
```

## Docker 容器化一键部署

本项目支持将前端、后端以及 Nginx 整合为单一全栈镜像，实现更轻量化的开箱即用。

### 1. 远程极速一键部署 (推荐)
若目标 Linux 服务器已安装 Docker，您可以直接拷贝以下单条指令远程交互拉取：
```bash
sudo -E bash -c 'bash <(curl -sSL https://raw.githubusercontent.com/NekroAI/nekro-webchat/main/deploy.sh)'
```

### 2. 本地执行脚本部署
若已克隆源码，也可在项目根目录下直接运行本地脚本：
```bash
chmod +x deploy.sh && ./deploy.sh
```

