# IT 揭榜台部署与基础架构沟通文档

本文用于和公司基础架构同事沟通 IT 需求与问题管理系统上线所需资源，并提供服务器部署步骤。

## 一句话说明

本系统是一个内部 Web/飞书网页应用，包含：

- Web 前端：员工提交需求/问题、查看记录、管理员处理记录。
- API 后端：权限、动态表单、审计、附件、飞书登录、多维表格同步。
- PostgreSQL：保存用户、权限、配置、审计、评论、通知、记录镜像。
- 飞书多维表格：作为业务数据主库和协同查看入口。

## 给基础架构同事的资源申请清单

可以直接把下面这段发给基础架构同事：

> 我们要部署一个内部 IT 需求与问题管理系统，需要一台公司内网服务器或云主机，用 Docker Compose 运行 Web、API 和 PostgreSQL。系统需要员工通过浏览器或飞书网页应用访问，同时后端需要访问飞书开放平台接口，用于飞书登录、多维表格读写、附件上传下载和消息通知。请协助提供服务器、域名/访问地址、HTTPS 证书、网络访问策略和数据备份支持。

### 服务器资源

建议规格：

- CPU：2 核起步，推荐 4 核。
- 内存：4 GB 起步，推荐 8 GB。
- 磁盘：50 GB 起步，推荐 100 GB，需支持扩容。
- 操作系统：Linux，推荐 Ubuntu 22.04/24.04 LTS 或公司标准 Linux 镜像。
- 运行环境：Docker Engine + Docker Compose Plugin。

磁盘用途：

- PostgreSQL 数据。
- 上传附件临时文件。
- Docker 镜像和日志。
- 数据库备份文件。

### 网络与访问

员工访问：

- PC 浏览器需要能访问 Web 域名。
- 飞书桌面端网页应用需要能访问同一个 Web 域名。
- 手机飞书如果要使用，需要手机能访问该域名，例如公司 Wi-Fi、VPN 或公司安全网关发布。

服务器出站访问：

- 服务器必须能访问飞书开放平台和飞书文件/多维表格相关接口。
- 至少需要允许 HTTPS 出站访问 `open.feishu.cn` 和飞书 CDN/文件下载域名。

入站访问：

- 推荐只开放 HTTPS `443`。
- 如需临时调试，可短期开启 HTTP `80` 或内网端口，但正式环境建议走 HTTPS。

### 域名与证书

建议准备一个内部或公司统一域名，例如：

```text
https://it-jiebang.company.com
```

需要基础架构提供：

- DNS 解析到部署服务器或反向代理。
- HTTPS 证书。
- 反向代理配置。

推荐路径：

- Web：`https://it-jiebang.company.com`
- API：`https://it-jiebang.company.com/api`
- 飞书回调：`https://it-jiebang.company.com/api/feishu/callback`

如果 API 与 Web 使用不同域名，需要额外配置 CORS：

```text
WEB_ORIGINS=https://it-jiebang.company.com
VITE_API_BASE_URL=https://it-jiebang-api.company.com
```

### 数据库与备份

第一版可以使用 Docker Compose 内置 PostgreSQL。

如果公司有统一数据库平台，也可以由基础架构提供 PostgreSQL 实例：

- PostgreSQL 版本：14+，推荐 16。
- 数据库名：`it_management`
- 用户：`it_user`
- 权限：该库的建表、索引、读写权限。
- 备份：建议每天至少一次，保留 30 天。

需要特别说明：

- 飞书多维表格保存业务记录主数据。
- PostgreSQL 保存系统配置、权限、审计、评论、通知、附件元数据和记录镜像，也需要备份。

### 飞书开放平台配合项

需要应用管理员/飞书开放平台管理员提供：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BITABLE_APP_TOKEN`
- 需求表 `table_id`
- 问题表 `table_id`
- 系统管理员表 `table_id`
- 消息通知所需权限。
- 通讯录读取 `user_id`/工号相关权限。
- 网页应用能力启用。

飞书后台需要配置：

```text
网页应用桌面端主页：https://it-jiebang.company.com
网页应用移动端主页：https://it-jiebang.company.com?feishu_webapp=1
重定向 URL：https://it-jiebang.company.com
事件回调地址：https://it-jiebang.company.com/api/feishu/callback
可信域名：it-jiebang.company.com
```

## 部署架构

推荐架构：

```text
员工浏览器 / 飞书客户端
        |
        | HTTPS 443
        v
公司 Nginx / 网关 / 负载均衡
        |
        +--> Web 容器，Nginx 静态文件
        |
        +--> API 容器，Node.js
                 |
                 +--> PostgreSQL
                 |
                 +--> 飞书开放平台 / 多维表格 / 消息接口
```

## 服务器部署步骤

以下步骤假设使用 Docker Compose 在单台 Linux 服务器部署。

### 1. 安装 Docker

由基础架构按公司标准安装：

```bash
docker --version
docker compose version
```

确认当前用户能执行 Docker 命令，或使用具备权限的部署账号。

### 2. 准备项目目录

示例：

```bash
sudo mkdir -p /opt/it-jiebangtai
sudo chown -R $USER:$USER /opt/it-jiebangtai
cd /opt/it-jiebangtai
```

拉取代码：

```bash
git clone <项目仓库地址> .
```

如果已经存在项目目录：

```bash
cd /opt/it-jiebangtai
git pull
```

### 3. 准备 `.env`

复制示例配置：

```bash
cp .env.example .env
```

正式环境重点配置：

```bash
NODE_ENV=production
API_PORT=4000
WEB_ORIGINS=https://it-jiebang.company.com
UPLOAD_DIR=/app/uploads

POSTGRES_DB=it_management
POSTGRES_USER=it_user
POSTGRES_PASSWORD=请改成强密码
DATABASE_URL=postgres://it_user:请改成强密码@postgres:5432/it_management

DEFAULT_ADMIN_NAME=沈昀初
DEFAULT_ADMIN_USER_ID=a10986

FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx
FEISHU_ENCRYPT_KEY=xxx
FEISHU_WEB_REDIRECT_URI=https://it-jiebang.company.com
FEISHU_BITABLE_APP_TOKEN=xxx
FEISHU_DEMAND_TABLE_ID=tblxxx
FEISHU_ISSUE_TABLE_ID=tblxxx
FEISHU_SYSTEM_OWNER_TABLE_ID=tblxxx
FEISHU_REQUIRE_REAL_API=true
FEISHU_MESSAGE_RECEIVE_ID_TYPE=user_id

VITE_API_BASE_URL=https://it-jiebang.company.com
VITE_REQUIRE_FEISHU_LOGIN=true
VITE_FEISHU_WEBAPP_AUTO_LOGIN=false
VITE_FEISHU_REMOTE_DEBUG=false
```

说明：

- `VITE_*` 是前端构建期配置，修改后必须重新构建 Web 镜像。
- `FEISHU_WEB_REDIRECT_URI` 必须和飞书开发者后台的重定向 URL 一致。
- `VITE_FEISHU_REMOTE_DEBUG` 只用于飞书网页应用调试，正式环境保持 `false`。

### 4. 构建并启动

```bash
docker compose up -d --build
```

首次启动时 API 容器会自动执行数据库迁移和种子数据初始化。

查看容器：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f api
docker compose logs -f web
docker compose logs -f postgres
```

### 5. 配置反向代理

如果 Web 和 API 共用一个域名，推荐 Nginx 代理：

```nginx
server {
    listen 443 ssl;
    server_name it-jiebang.company.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    client_max_body_size 50m;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    location / {
        proxy_pass http://127.0.0.1:5173/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

如果公司网关已经统一代理，只需要把：

- `/` 转发到服务器 `5173`
- `/api/` 转发到服务器 `4000`

### 6. 验证服务

检查 API：

```bash
curl https://it-jiebang.company.com/api/health
```

打开 Web：

```text
https://it-jiebang.company.com
```

检查飞书连接：

```bash
curl https://it-jiebang.company.com/api/feishu/status
curl https://it-jiebang.company.com/api/feishu/bitable/status
```

验证功能：

- 飞书登录。
- 提交一条测试需求。
- 写入飞书多维表格。
- 附件上传、下载。
- 状态流转。
- 飞书消息通知。

### 7. 飞书网页应用配置

在飞书开发者后台配置：

```text
桌面端主页：https://it-jiebang.company.com
移动端主页：https://it-jiebang.company.com?feishu_webapp=1
重定向 URL：https://it-jiebang.company.com
事件回调地址：https://it-jiebang.company.com/api/feishu/callback
```

配置完成后发布应用版本，让企业成员可见。

## 日常运维

### 更新版本

```bash
cd /opt/it-jiebangtai
git pull
docker compose up -d --build
```

### 查看日志

```bash
docker compose logs -f api
docker compose logs -f web
```

### 停止服务

```bash
docker compose down
```

### 数据库备份

使用 Docker 内置 PostgreSQL 时：

```bash
docker exec it-jiebangtai-postgres pg_dump -U it_user it_management > backup-$(date +%F).sql
```

恢复示例：

```bash
cat backup-2026-06-03.sql | docker exec -i it-jiebangtai-postgres psql -U it_user it_management
```

### 附件目录备份

如果使用本地上传目录，需要备份 `UPLOAD_DIR` 对应目录。Docker 内置部署建议后续把上传目录挂载为独立 volume 或公司文件存储。

## 上线前检查表

- [ ] 服务器 Docker 和 Docker Compose 可用。
- [ ] 域名和 HTTPS 证书可用。
- [ ] 员工 PC 能访问系统域名。
- [ ] 手机飞书如需访问，手机网络能访问系统域名。
- [ ] 服务器能访问飞书开放平台。
- [ ] `.env` 已填写正式飞书密钥和多维表格 ID。
- [ ] 飞书后台已配置网页应用主页、重定向 URL、事件回调地址。
- [ ] 数据库备份策略已确认。
- [ ] 超级管理员 `DEFAULT_ADMIN_USER_ID=a10986` 已配置。
- [ ] 正式环境 `VITE_FEISHU_REMOTE_DEBUG=false`。

## 常见问题

### 飞书登录提示重定向 URL 错误

检查：

- `.env` 里的 `FEISHU_WEB_REDIRECT_URI`
- 飞书开发者后台的重定向 URL
- 浏览器实际访问的域名

三者必须一致。

### 员工电脑能访问，手机飞书不能访问

通常是手机网络不能访问公司内网域名。需要：

- 手机连公司 Wi-Fi。
- 或手机连 VPN。
- 或由公司网关发布 HTTPS 访问入口。

### 前端仍然请求旧 API 地址

`VITE_API_BASE_URL` 是构建期变量。修改 `.env` 后必须重新构建：

```bash
docker compose up -d --build web
```

### 飞书消息发送失败

检查：

- `FEISHU_MESSAGE_RECEIVE_ID_TYPE=user_id`
- 系统管理员配置里的 `user_id` 是否为正确工号/飞书 user_id。
- 飞书应用是否已启用机器人或消息能力。
- 应用权限是否已发布生效。
