# Stremio Donghua Aggregator Addon

这是一个聚合了多个动漫资源站（DonghuaFun, Animekhor, Donghuaworld）的 Stremio 插件。

## 部署指南

### 1. 准备工作
在部署之前，请确保你已经准备好了 GitHub 仓库并推送了最新代码。

### 2. 使用 Docker 部署 (推荐)
本项目提供了 Docker 支持，可以确保在任何环境下运行一致。

#### 本地运行测试
```bash
# 复制并配置环境变量
cp .env.example .env
# 修改 .env 中的 TMDB_API_KEY 等配置

# 启动容器
docker-compose up -d
```

#### 云端部署 (Railway / Render)
1. 在 [Railway](https://railway.app/) 或 [Render](https://render.com/) 上关联你的 GitHub 仓库。
2. 平台会自动识别 `Dockerfile` 并进行构建。
3. **重要**：在平台控制台中配置以下环境变量：
   - `TMDB_API_KEY`
   - `MEDIAFLOW_PROXY_URL`
   - `MEDIAFLOW_API_PASSWORD`
4. **无需持久化存储**：由于插件现在使用内存缓存，重启后缓存会重置。

### 3. 发布到 Stremio
部署完成后，你将获得一个公网 URL（例如 `https://your-addon.up.railway.app`）。

1. 打开 Stremio 客户端。
2. 进入 **Addons** 页面。
3. 在搜索框中粘贴你的插件地址：`https://your-addon.up.railway.app/manifest.json`
4. 点击 **Install**。

## 环境变量说明
| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `PORT` | 服务端口 | `3000` |
| `TMDB_API_KEY` | TMDB API 密钥 | `your_key` |
| `BANGUMI_API_URL` | Bangumi API 地址 | `https://api.bgm.tv` |
| `MEDIAFLOW_PROXY_URL` | MediaFlow 代理地址 | `http://proxy:8080` |
| `MEDIAFLOW_API_PASSWORD`| MediaFlow 密码 | `your_password` |
| `LOG_LEVEL` | 日志级别 | `info` |

## 开发
```bash
npm install
npm run dev
```
