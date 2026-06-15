# 飞书网页应用接入说明

本项目优先使用飞书网页应用能力承载移动端和飞书工作台入口，复用现有 Web 前端和 API 后端，不单独重写小程序业务逻辑。

服务器资源、网络、域名、证书和 Docker 部署步骤见 [deployment.md](./deployment.md)。

## 推荐访问地址

正式部署建议准备一个 HTTPS 域名，例如：

- Web 主页：`https://it-jiebang.company.com`
- API 地址：`https://it-jiebang.company.com/api` 或 `https://it-jiebang-api.company.com`

如果部署在公司内网，飞书客户端所在设备必须能访问该内网域名。手机端需要公司 Wi-Fi、VPN 或公司网关发布能力。

## 飞书开发者后台配置

在企业自建应用中启用「网页应用」能力：

- 桌面端主页：`https://it-jiebang.company.com`
- 移动端主页：`https://it-jiebang.company.com?feishu_webapp=1`
- 重定向 URL：`https://it-jiebang.company.com`
- 可信域名：`it-jiebang.company.com`

本地调试可临时使用内网穿透或局域网 HTTPS 地址。飞书后台配置的重定向 URL 要和前端实际发起登录时的地址一致。

## 环境变量

前端：

```bash
VITE_API_BASE_URL=https://it-jiebang.company.com
VITE_REQUIRE_FEISHU_LOGIN=true
VITE_FEISHU_WEBAPP_AUTO_LOGIN=false
```

后端：

```bash
FEISHU_WEB_REDIRECT_URI=https://it-jiebang.company.com
WEB_ORIGINS=https://it-jiebang.company.com
FEISHU_REQUIRE_REAL_API=true
```

`VITE_FEISHU_WEBAPP_AUTO_LOGIN=false` 表示首次进入时显示登录按钮。等重定向 URL 和权限稳定后，可以改成 `true`，在飞书客户端内自动进入登录流程。

## 已实现能力

- 自动识别飞书客户端环境，并给页面加 `feishu-webapp` 样式类。
- 飞书登录使用当前页面地址作为 OAuth `redirectUri`。
- 移动端飞书网页应用下，左侧导航会变成底部导航。
- 移动端编辑弹窗会变成全屏工作流。
- 后台配置、提交、记录、附件、状态流转继续复用 Web/API 逻辑。

## 测试步骤

1. 本地启动 API 和 Web。
2. 用浏览器访问 `http://localhost:5173?feishu_webapp=1` 检查移动端布局。
3. 正式环境配置 HTTPS 域名后，在飞书开发者后台填写桌面端主页和移动端主页。
4. 打开飞书工作台中的应用，点击「飞书登录」。
5. 登录后验证提交、记录详情、附件下载、管理员处理。

## 后续可增强

- 接入飞书 H5 JSAPI 鉴权，用于选择图片、预览文件、设置导航栏样式。
- 按飞书移动端优化附件上传入口。
- 为记录详情做移动端独立路由，便于消息通知直接打开某条记录。
