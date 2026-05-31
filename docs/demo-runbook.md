# 明天演示启动手册

这份手册用于在本机演示 IT 揭榜台。命令都在项目根目录执行：

```bash
cd /Users/sylas/Documents/IT揭榜台
```

## 1. 演示前检查

确认 Docker Desktop 已打开，并且 Docker Engine 已经运行：

```bash
docker --version
docker-compose version
```

确认 Node.js 和 npm 可用：

```bash
node --version
npm --version
```

确认项目依赖已安装。如果没有安装过，先执行：

```bash
npm install
```

确认 `.env` 已存在：

```bash
ls -la .env
```

如果没有 `.env`，复制模板后再补飞书密钥和多维表格配置：

```bash
cp .env.example .env
```

## 2. 启动数据库

只启动 PostgreSQL：

```bash
docker-compose up -d postgres
```

确认数据库容器正在运行：

```bash
docker ps --filter "name=it-jiebangtai-postgres"
```

## 3. 初始化后端数据

第一次演示或数据库重建后执行。重复执行是安全的，迁移脚本会跳过已执行的 SQL：

```bash
npm run db:migrate
npm run db:seed
```

如果需要重新导入 Excel 历史数据：

```bash
npm run import:excel -- "/Users/sylas/Documents/IT揭榜台/需求及问题 管理 副本.xlsx"
```

## 4. 拉起后端 API

打开一个终端窗口，保持它不要关闭：

```bash
npm run dev -w apps/api
```

看到类似下面的信息，表示后端启动成功：

```text
Server listening at http://127.0.0.1:4000
```

另开一个终端窗口检查后端健康状态：

```bash
curl http://localhost:4000/health
```

再检查当前登录模拟身份。演示管理员应返回 `role: "admin"`：

```bash
curl http://localhost:4000/api/auth/me \
  -H "x-dev-user-id: a10986" \
  -H "x-dev-user-name: %E6%B2%88%E6%98%80%E5%88%9D"
```

## 5. 拉起网页前端

再打开一个新的终端窗口，保持它不要关闭：

```bash
npm run dev -w apps/web
```

浏览器打开：

```text
http://localhost:5173
```

演示建议顺序：

1. 进入“记录”，筛选 `LMES1.0`，展示记录列表、详情、时间线、完整字段编辑。
2. 进入“提交”，选择需求或问题，系统选择 `LMES1.0`，展示动态表单和自动分派。
3. 进入“后台”，展示提交表单配置、自定义字段、从多维表格同步按钮、系统管理员配置。
4. 打开飞书多维表格，确认记录和字段同步。

## 6. 常见问题

如果 `localhost:4000` 被占用，先查占用进程：

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

如果 `localhost:5173` 被占用，先查占用进程：

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

如果网页提示后端连接失败，优先确认：

```bash
curl http://localhost:4000/health
```

如果飞书相关功能失败，优先确认 `.env` 中这些值已经填写：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
FEISHU_BITABLE_APP_TOKEN
FEISHU_DEMAND_TABLE_ID
FEISHU_ISSUE_TABLE_ID
FEISHU_SYSTEM_OWNER_TABLE_ID
```

如果后台看不到“从多维表格同步”，确认当前用户是沈昀初 `a10986`，并刷新页面。

## 7. 演示结束后停止服务

在运行后端和前端的两个终端窗口中分别按：

```text
Control + C
```

停止 PostgreSQL：

```bash
docker-compose stop postgres
```

如果想完全停止并删除容器，但保留数据库卷：

```bash
docker-compose down
```
