# 演示启动命令

先确认 `.env` 已经填好飞书配置，尤其是：

```text
FEISHU_APP_SECRET
FEISHU_BITABLE_APP_TOKEN
FEISHU_DEMAND_TABLE_ID
FEISHU_ISSUE_TABLE_ID
FEISHU_SYSTEM_OWNER_TABLE_ID
FEISHU_REQUIRE_REAL_API=true
```

## 1. 进入项目

```bash
cd /Users/sylas/Documents/IT揭榜台
```

## 2. 启动数据库

```bash
docker-compose up -d postgres
```

## 3. 初始化数据库

```bash
npm run db:migrate
npm run db:seed
```

## 4. 启动后端

```bash
npm run dev -w apps/api
```

## 5. 启动前端

另开一个终端：

```bash
npm run dev -w apps/web
```

## 6. 打开网页

```text
http://localhost:5173
```
