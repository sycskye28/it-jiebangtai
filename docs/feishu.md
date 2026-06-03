# 飞书接入说明

## 应用能力

后端预留了以下飞书能力：

- 飞书登录。
- 获取用户 `user_id`、姓名、部门。
- 飞书多维表格读写。
- 飞书消息通知。
- 飞书事件回调。

本地开发默认使用 mock 通知和请求头模拟用户。正式接入时将 `.env` 中：

```bash
FEISHU_REQUIRE_REAL_API=true
```

当前消息通知使用 `user_id`，也就是飞书通讯录用户 ID/工号：

```bash
FEISHU_MESSAGE_RECEIVE_ID_TYPE=user_id
```

## 第一步：连接检查

后端提供飞书连接检查接口：

```bash
curl http://localhost:4000/api/feishu/status
```

返回 `tokenOk: true` 表示后端已经能通过 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 获取飞书 `tenant_access_token`。

## 第二步：消息发送测试

发送一条测试消息：

```bash
curl -X POST http://localhost:4000/api/feishu/test-message \
  -H "content-type: application/json" \
  -d '{"receiveId":"你的 user_id","receiveIdType":"user_id","text":"IT 揭榜台测试消息"}'
```

如果返回权限错误，需要在飞书开放平台给应用开通消息发送相关权限并发布/生效。

已验证：

- `receiveIdType=open_id` 可发送成功。
- `receiveIdType=user_id` 使用 `a10986` 可发送成功。

当前排查记录：

- 使用 `receiveIdType=user_id` 给 `ou_...` 发送时，飞书返回需要 `contact:user.employee_id:readonly`，说明该 ID 不适合作为 `user_id` 发送。
- 使用 `receiveIdType=open_id` 给 `ou_...` 发送时，飞书返回 `Bot ability is not activated.`，说明 ID 类型更接近 `open_id`，但应用还没有启用机器人能力。

下一步需要在飞书开放平台应用后台完成：

- 启用机器人能力。
- 申请消息发送权限，例如 `im:message`。
- 将应用版本发布/生效到当前租户。
- 确认接收人可以和该应用机器人会话，必要时先把机器人添加到会话或安装应用。

## 第三步：登录 code 换用户身份

后端接口：

```bash
curl -X POST http://localhost:4000/api/auth/feishu/login \
  -H "content-type: application/json" \
  -d '{"code":"飞书小程序或网页登录得到的 code"}'
```

流程：

1. 前端通过飞书小程序 `tt.requestAccess` 或网页登录能力获取临时 `code`。
2. 后端用 `app_access_token` 调用 `authen/v1/oidc/access_token` 换 `user_access_token`。
3. 后端用 `user_access_token` 调用 `authen/v1/user_info` 获取 `open_id`、`user_id`、姓名等。
4. 后端写入本地 `users` 表，并返回系统用户信息。

## 第四步：多维表格连接检查

配置：

```bash
FEISHU_BITABLE_APP_TOKEN=多维表格 app_token
FEISHU_DEMAND_TABLE_ID=需求表 table_id
FEISHU_ISSUE_TABLE_ID=问题表 table_id
FEISHU_SYSTEM_OWNER_TABLE_ID=系统管理员表 table_id
```

检查连接：

```bash
curl http://localhost:4000/api/feishu/bitable/status
```

列出数据表：

```bash
curl http://localhost:4000/api/feishu/bitable/tables
```

列字段：

```bash
curl http://localhost:4000/api/feishu/bitable/tables/{table_id}/fields
```

读少量记录：

```bash
curl "http://localhost:4000/api/feishu/bitable/tables/{table_id}/records?pageSize=10"
```

## 回调地址

本地开发可用内网穿透：

```text
https://xxxx.ngrok.app/api/feishu/callback
```

正式部署使用公司域名：

```text
https://你的域名/api/feishu/callback
```

## 多维表格

第一版代码先将记录写入 PostgreSQL 本地镜像，保证本地可完整测试。正式接入飞书多维表格时，需要补充：

- `FEISHU_BITABLE_APP_TOKEN`
- 需求表 `table_id`
- 问题表 `table_id`
- 系统管理员表 `table_id`

字段映射已经保存在 `field_configs.feishu_field_name`，后续接真实多维表格写入时不需要改前端。
