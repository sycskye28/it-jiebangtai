# IT 揭榜台

公司 IT 部门需求与问题管理系统。系统提供浏览器 Web 端、飞书小程序端和后端 API，第一版使用飞书多维表格作为业务主库，PostgreSQL 管理配置、权限、审计、评论和通知规则。

## 模块

- `apps/web`：浏览器工作台，包含统一提交入口、记录追踪和后台管理。
- `apps/miniapp`：飞书小程序端，复用动态表单和 API 设计。
- `apps/api`：后端 API，负责飞书登录、权限、动态表单、记录、评论、审计、通知和迁移。
- `packages/shared`：共享类型、DTO 和表单配置类型。
- `docs`：部署、测试和飞书接入文档。

## 本地启动

1. 复制环境变量：

```bash
cp .env.example .env
```

2. 启动 PostgreSQL：

```bash
docker-compose up -d postgres
```

3. 初始化数据库：

```bash
npm install
npm run db:migrate
npm run db:seed
```

4. 导入 Excel 历史数据：

```bash
npm run import:excel -- "/Users/sylas/Documents/IT揭榜台/需求及问题 管理 副本.xlsx"
```

5. 启动开发服务：

```bash
npm run dev
```

访问：

- Web：http://localhost:5173
- API：http://localhost:4000/health

## Docker 一键启动

```bash
cp .env.example .env
docker-compose up -d --build
```

API 容器启动时会自动执行数据库迁移和基础种子数据。

## 当前实现状态

- 已实现动态表单配置、需求/问题提交、自动分派、记录列表、详情、评论、时间线、审计日志、外部访问申请、后台字段查看、系统管理员查看。
- 已实现 Excel 迁移脚本，支持三张导出表。
- 飞书真实 API 调用已预留服务层；默认本地使用 mock 通知与开发用户头，方便先完成本地联调。
- 飞书小程序已搭建 Taro 工程骨架和统一提交页。

## 重要安全说明

`.env` 不提交到仓库。正式部署前建议轮换飞书 `app_secret`，并只通过服务器环境变量或 `.env` 管理密钥。
