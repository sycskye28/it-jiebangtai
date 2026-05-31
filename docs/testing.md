# 测试说明

## 基础检查

```bash
npm run typecheck
npm run build
```

## API 手工检查

```bash
curl http://localhost:4000/health
curl http://localhost:4000/api/form-types
```

开发模式默认通过请求头模拟飞书用户：

```bash
curl http://localhost:4000/api/auth/me \
  -H "x-dev-user-id: dev-admin" \
  -H "x-dev-user-name: 彭涛" \
  -H "x-dev-role: admin"
```

## 重点场景

- 动态字段：后台字段配置变化后，提交页字段应变化。
- 自动分派：选择 `MPPS` 时负责人为李济涵；选择未知系统时负责人为彭涛。
- 权限：业务用户只看自己提交；系统管理员只看自己负责；管理员看全部。
- 审计：创建和修改记录后，详情页能看到审计信息。
- 评论：记录详情可追加评论，时间线同步新增事件。
- 迁移：导入 Excel 后需求和问题记录数量增加，并生成 `import-report-*.json`。
