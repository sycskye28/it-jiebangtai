# 部署说明

## 本地 Docker

Mac 本地建议使用 Docker Desktop。当前机器也已安装 `docker` CLI、`docker-compose` 和 Colima，二者任选一种 Docker 运行环境即可。安装完成后验证：

```bash
docker --version
docker-compose version
```

如果使用 Docker Desktop，请先打开 Docker Desktop，等左下角显示 Docker Engine running。

如果使用 Colima：

```bash
colima start
docker context use colima
```

## 公司云服务器

服务器需要：

- Docker
- Docker Compose
- 可访问公网的域名
- HTTPS 证书

部署步骤：

```bash
git pull
cp .env.example .env
docker-compose up -d --build
```

将 `.env` 中这些值改成正式配置：

```bash
WEB_ORIGINS=https://你的域名
VITE_API_BASE_URL=https://你的域名
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_VERIFICATION_TOKEN=...
FEISHU_ENCRYPT_KEY=...
FEISHU_BITABLE_APP_TOKEN=...
FEISHU_REQUIRE_REAL_API=true
```

飞书回调地址填写：

```text
https://你的域名/api/feishu/callback
```

## Nginx

`nginx/prod.conf.example` 是服务器反向代理示例。正式 HTTPS 建议使用公司已有证书或 `certbot` 配置。

## 数据备份

PostgreSQL 存放权限、配置、审计、评论和通知规则，需要定期备份：

```bash
docker exec it-jiebangtai-postgres pg_dump -U it_user it_management > backup.sql
```
