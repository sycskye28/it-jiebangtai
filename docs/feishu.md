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

## 搜索选择权限名单

超级管理员在后台“权限控制”中搜索飞书用户，并将用户设置为 `IT管理员` 或 `超级管理员`：

- 搜索调用飞书 `GET /open-apis/search/v1/user`。
- 该接口使用用户身份 `user_access_token`，需要开通 `contact:user:search` 权限。
- 如果当前登录用户没有有效 `feishu_user_access_token`，后端返回 `missing_user_token`，需要重新飞书登录。
- 权限名单外的人员登录后默认为 `业务用户`。

## 管理员身份判定

权限不再按飞书返回的部门名称判断，因为信息数字化部下还有数字化运营、IT 业务伙伴、IT 技术、基础架构等子部门，实际返回值可能不稳定。

当前规则：

- `沈昀初 / a10986` 固定为超级管理员，可进入后台。
- 后台“权限控制”中启用且角色为 `超级管理员` 的人员可进入后台。
- 后台“权限控制”中启用且角色为 `IT管理员` 的人员可处理记录、编辑字段、追加系统、转换类型等。
- 其他人员为业务用户。
- 飞书返回的部门信息只做展示和留档，不再决定管理员权限。

## 当前飞书提醒内容与触发条件

所有已接入的飞书提醒都会发送给：

- 记录提交人，对应记录中的 `submitter_feishu_user_id`。
- 当前系统管理员，对应系统管理员配置中的 `owner_feishu_user_id`。

提醒发送失败时不会阻断业务操作，系统会在记录时间线中新增一条“飞书消息通知失败”事件，并保存飞书返回的错误信息。

### 1. 用户提交新记录

触发条件：

- 用户成功提交需求、问题、创新工作室或后续新增的其他提交类型。
- PostgreSQL 记录创建成功后立即触发。

提醒标题：

```text
新{提交类型}：{记录标题}
```

提醒正文：

```text
系统：{所属系统}
负责人：{系统管理员}
```

示例：

```text
新需求：LMES 报工页面优化
系统：LMES1.0
负责人：沈昀初
```

### 2. 管理员追加其他系统记录

触发条件：

- 管理员在完整字段编辑中使用“追加系统”。
- 每成功生成一条其他系统的独立记录，就发送一次提醒。

提醒标题：

```text
新{提交类型}：{记录标题}
```

提醒正文：

```text
系统：{新增系统}
负责人：{新增系统管理员}
```

接收人：

- 原记录提交人。
- 新增系统对应的系统管理员。

### 3. 记录状态发生变化

触发条件：

- 管理员保存记录后，记录状态与保存前不同。
- 新状态不能是“待处理”。
- 包括手动修改状态，以及系统根据完成时间自动修改状态。

当前自动状态触发规则：

- 管理员修改其他处理字段：`处理中`
- 填写设计完成时间：`设计已完成`
- 填写开发完成时间：`开发已完成`
- 填写测试完成时间：`测试已完成`
- 填写部署完成时间或部署上线时间：`部署已完成`

提醒标题：

```text
状态更新：{记录标题}
```

提醒正文：

```text
系统：{所属系统}
状态：{新状态}
负责人：{系统管理员}
```

### 已配置但暂未接入实际发送的规则

数据库初始化时还会创建以下通知规则，但当前业务代码没有调用它们，因此暂时不会实际发送飞书消息：

- `need_more_info`：需补充信息。
- `record_closed`：完成关闭。

后台通知规则目前属于配置预留。后续接入时需要明确触发按钮/字段、接收人和消息模板。

当前如果状态变为“已关闭”，仍会按照上面的 `status_changed` 状态变化提醒发送，但不会使用 `record_closed` 的独立模板。

### 当前不会触发飞书提醒的操作

- 新增评论或补充说明。
- 修改普通字段但状态没有变化。
- 需求与问题相互转换。
- 删除记录。
- 从飞书多维表格同步记录。
- 后台字段配置、系统管理员配置等变更。

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
FEISHU_BITABLE_WEB_URL=浏览器中可直接打开的多维表格链接
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
