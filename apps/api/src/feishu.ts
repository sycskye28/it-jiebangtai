import { config } from "./config.js";

type NotificationPayload = {
  eventKey: string;
  title: string;
  body: string;
  submitterFeishuUserId?: string | null;
  ownerFeishuUserId?: string | null;
};

type ReceiveIdType = "open_id" | "user_id" | "union_id" | "email" | "chat_id";

export class FeishuService {
  private appAccessToken: string | null = null;
  private appTokenExpiresAt = 0;
  private tenantAccessToken: string | null = null;
  private tokenExpiresAt = 0;

  isConfigured() {
    return Boolean(config.feishu.appId && config.feishu.appSecret);
  }

  maskedAppId() {
    if (!config.feishu.appId) return "";
    return `${config.feishu.appId.slice(0, 8)}...${config.feishu.appId.slice(-4)}`;
  }

  async getTenantAccessToken() {
    if (!config.feishu.requireRealApi) return "mock-tenant-access-token";
    if (!config.feishu.appId || !config.feishu.appSecret) {
      throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required for real Feishu API calls.");
    }
    if (this.tenantAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.tenantAccessToken;
    }
    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: config.feishu.appId,
        app_secret: config.feishu.appSecret
      })
    });
    const data = await response.json() as { code: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Failed to get Feishu token: ${data.msg ?? data.code}`);
    }
    this.tenantAccessToken = data.tenant_access_token;
    this.tokenExpiresAt = Date.now() + Math.max(60, (data.expire ?? 7200) - 120) * 1000;
    return this.tenantAccessToken;
  }

  async getAppAccessToken() {
    if (!config.feishu.requireRealApi) return "mock-app-access-token";
    if (!config.feishu.appId || !config.feishu.appSecret) {
      throw new Error("FEISHU_APP_ID and FEISHU_APP_SECRET are required for real Feishu API calls.");
    }
    if (this.appAccessToken && Date.now() < this.appTokenExpiresAt) {
      return this.appAccessToken;
    }
    const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: config.feishu.appId,
        app_secret: config.feishu.appSecret
      })
    });
    const data = await response.json() as { code: number; msg?: string; app_access_token?: string; expire?: number };
    if (data.code !== 0 || !data.app_access_token) {
      throw new Error(`Failed to get Feishu app token: ${data.msg ?? data.code}`);
    }
    this.appAccessToken = data.app_access_token;
    this.appTokenExpiresAt = Date.now() + Math.max(60, (data.expire ?? 7200) - 120) * 1000;
    return this.appAccessToken;
  }

  async checkConnection() {
    const status = {
      mode: config.feishu.requireRealApi ? "real" : "mock",
      appId: this.maskedAppId(),
      configured: this.isConfigured(),
      tokenOk: false,
      tokenExpiresAt: this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : null,
      message: ""
    };

    if (!config.feishu.requireRealApi) {
      return {
        ...status,
        tokenOk: true,
        message: "FEISHU_REQUIRE_REAL_API=false，当前使用本地 mock 模式。"
      };
    }

    try {
      await this.getTenantAccessToken();
      return {
        ...status,
        tokenOk: true,
        tokenExpiresAt: new Date(this.tokenExpiresAt).toISOString(),
        message: "飞书 tenant_access_token 获取成功。"
      };
    } catch (error) {
      return {
        ...status,
        tokenOk: false,
        message: error instanceof Error ? error.message : "飞书连接检查失败。"
      };
    }
  }

  async sendNotification(payload: NotificationPayload) {
    if (!config.feishu.requireRealApi) {
      console.info("[feishu:mock-notification]", payload);
      return { ok: true, mocked: true };
    }
    const recipients = [payload.submitterFeishuUserId, payload.ownerFeishuUserId].filter((id): id is string => Boolean(id));
    const results = [];
    for (const receiveId of recipients) {
      results.push(await this.sendTextMessage({
        receiveId,
        receiveIdType: config.feishu.messageReceiveIdType as ReceiveIdType,
        text: `${payload.title}\n${payload.body}`
      }));
    }
    return { ok: true, results };
  }

  async sendTextMessage(input: { receiveId: string; receiveIdType: ReceiveIdType; text: string }) {
    if (!config.feishu.requireRealApi) {
      console.info("[feishu:mock-message]", input);
      return { ok: true, mocked: true };
    }
    const token = await this.getTenantAccessToken();
    const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${input.receiveIdType}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        receive_id: input.receiveId,
        msg_type: "text",
        content: JSON.stringify({ text: input.text })
      })
    });
    const data = await response.json() as { code?: number; msg?: string; data?: unknown };
    if (!response.ok || data.code !== 0) {
      throw new Error(`Feishu message send failed: ${data.msg ?? response.statusText}`);
    }
    return data;
  }

  async exchangeLoginCode(code: string) {
    if (!config.feishu.requireRealApi) {
      return {
        accessToken: "mock-user-access-token",
        expiresIn: 7200,
        refreshToken: "mock-refresh-token",
        refreshExpiresIn: 2592000,
        scope: "",
        userInfo: {
          name: "彭涛",
          open_id: "mock-open-id",
          user_id: "a10986",
          employee_no: "a10986"
        }
      };
    }

    const appToken = await this.getAppAccessToken();
    const tokenResponse = await fetch("https://open.feishu.cn/open-apis/authen/v1/access_token", {
      method: "POST",
      headers: {
        authorization: `Bearer ${appToken}`,
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code
      })
    });
    const tokenData = await tokenResponse.json() as {
      code: number;
      msg?: string;
      data?: {
        access_token: string;
        expires_in: number;
        refresh_token?: string;
        refresh_expires_in?: number;
        scope?: string;
        open_id?: string;
        union_id?: string;
        user_id?: string;
        employee_no?: string;
        name?: string;
        en_name?: string;
        avatar_url?: string;
        email?: string;
        enterprise_email?: string;
        mobile?: string;
        tenant_key?: string;
      };
    };
    if (tokenData.code !== 0 || !tokenData.data?.access_token) {
      throw new Error(`Failed to exchange Feishu login code: ${tokenData.msg ?? tokenData.code}`);
    }

    const { access_token, expires_in, scope, refresh_token, refresh_expires_in, ...inlineUserInfo } = tokenData.data;
    const userInfo = inlineUserInfo.open_id || inlineUserInfo.user_id || inlineUserInfo.name
      ? inlineUserInfo
      : await this.getLoginUserInfo(access_token);
    return {
      accessToken: access_token,
      expiresIn: expires_in,
      refreshToken: refresh_token ?? null,
      refreshExpiresIn: refresh_expires_in ?? null,
      scope: scope ?? "",
      userInfo
    };
  }

  async refreshUserAccessToken(refreshToken: string) {
    if (!config.feishu.requireRealApi) {
      return {
        accessToken: "mock-user-access-token",
        expiresIn: 7200,
        refreshToken: "mock-refresh-token",
        refreshExpiresIn: 2592000,
        scope: ""
      };
    }
    const appToken = await this.getAppAccessToken();
    const response = await fetch("https://open.feishu.cn/open-apis/authen/v1/oidc/refresh_access_token", {
      method: "POST",
      headers: {
        authorization: `Bearer ${appToken}`,
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken
      })
    });
    const data = await response.json() as {
      code: number;
      msg?: string;
      data?: {
        access_token: string;
        expires_in: number;
        refresh_token?: string;
        refresh_expires_in?: number;
        scope?: string;
      };
    };
    if (!response.ok || data.code !== 0 || !data.data?.access_token) {
      throw new Error(`Failed to refresh Feishu user token: ${data.msg ?? response.statusText}`);
    }
    return {
      accessToken: data.data.access_token,
      expiresIn: data.data.expires_in,
      refreshToken: data.data.refresh_token ?? null,
      refreshExpiresIn: data.data.refresh_expires_in ?? null,
      scope: data.data.scope ?? ""
    };
  }

  async getLoginUserInfo(userAccessToken: string) {
    const response = await fetch("https://open.feishu.cn/open-apis/authen/v1/user_info", {
      method: "GET",
      headers: {
        authorization: `Bearer ${userAccessToken}`
      }
    });
    const data = await response.json() as { code: number; msg?: string; data?: Record<string, unknown> };
    if (data.code !== 0 || !data.data) {
      throw new Error(`Failed to get Feishu user info: ${data.msg ?? data.code}`);
    }
    return data.data;
  }

  async searchUsers(userAccessToken: string, input: { query: string; pageSize?: number; pageToken?: string }) {
    if (!config.feishu.requireRealApi) {
      return {
        users: [
          {
            userId: "a10986",
            openId: "mock-open-id",
            name: input.query || "沈昀初",
            department: "信息数字化部",
            avatarUrl: ""
          }
        ],
        hasMore: false,
        pageToken: null
      };
    }
    const search = new URLSearchParams({
      query: input.query,
      page_size: String(input.pageSize ?? 10)
    });
    if (input.pageToken) search.set("page_token", input.pageToken);
    const response = await fetch(`https://open.feishu.cn/open-apis/search/v1/user?${search.toString()}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${userAccessToken}`
      }
    });
    const data = await response.json() as {
      code: number;
      msg?: string;
      data?: {
        users?: Array<Record<string, unknown>>;
        items?: Array<Record<string, unknown>>;
        has_more?: boolean;
        page_token?: string;
      };
    };
    if (!response.ok || data.code !== 0) {
      throw new Error(`Feishu user search failed: ${data.msg ?? response.statusText}`);
    }
    const users = (data.data?.users ?? data.data?.items ?? []).map((item) => ({
      userId: String(item.user_id ?? item.userId ?? ""),
      openId: item.open_id ? String(item.open_id) : item.openId ? String(item.openId) : null,
      name: String(item.name ?? item.cn_name ?? item.en_name ?? item.user_name ?? ""),
      department: Array.isArray(item.departments)
        ? item.departments.map((department) => String((department as any).name ?? department)).filter(Boolean).join(" / ")
        : item.department_name
          ? String(item.department_name)
          : item.department
            ? String(item.department)
            : null,
      avatarUrl: item.avatar_url ? String(item.avatar_url) : item.avatarUrl ? String(item.avatarUrl) : null
    })).filter((user) => user.userId && user.name);
    return {
      users,
      hasMore: Boolean(data.data?.has_more),
      pageToken: data.data?.page_token ?? null
    };
  }

  private async bitableRequest<T>(path: string, options: RequestInit = {}) {
    if (!config.feishu.bitableAppToken) {
      throw new Error("FEISHU_BITABLE_APP_TOKEN is not configured.");
    }
    const token = await this.getTenantAccessToken();
    const response = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${config.feishu.bitableAppToken}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
        ...(options.headers ?? {})
      }
    });
    const data = await response.json() as { code: number; msg?: string; data?: T };
    if (!response.ok || data.code !== 0) {
      throw new Error(`Feishu bitable request failed: ${data.msg ?? response.statusText}`);
    }
    return data.data as T;
  }

  async listBitableTables() {
    return this.bitableRequest<{ items: Array<{ table_id: string; name: string }>; page_token?: string; has_more?: boolean }>("/tables");
  }

  async createBitableTable(name: string) {
    return this.bitableRequest<{ table_id?: string; table?: { table_id?: string } }>("/tables", {
      method: "POST",
      body: JSON.stringify({ table: { name } })
    });
  }

  async listBitableFields(tableId: string) {
    return this.bitableRequest<{ items: Array<Record<string, unknown>> }>(`/tables/${tableId}/fields`);
  }

  async createBitableField(tableId: string, body: { fieldName: string; type: number; property?: Record<string, unknown> | null }) {
    return this.bitableRequest<{ field: Record<string, unknown> }>(`/tables/${tableId}/fields`, {
      method: "POST",
      body: JSON.stringify({
        field_name: body.fieldName,
        type: body.type,
        property: body.property ?? null
      })
    });
  }

  async updateBitableField(tableId: string, fieldId: string, body: { fieldName: string; type: number; property?: Record<string, unknown> | null }) {
    return this.bitableRequest<{ field: Record<string, unknown> }>(`/tables/${tableId}/fields/${fieldId}`, {
      method: "PUT",
      body: JSON.stringify({
        field_name: body.fieldName,
        type: body.type,
        property: body.property ?? null
      })
    });
  }

  async listBitableRecords(tableId: string, pageSize = 10, pageToken?: string) {
    const search = new URLSearchParams({ page_size: String(pageSize) });
    if (pageToken) search.set("page_token", pageToken);
    return this.bitableRequest<{ items: Array<Record<string, unknown>>; page_token?: string; has_more?: boolean }>(`/tables/${tableId}/records?${search}`);
  }

  async listAllBitableRecordIds(tableId: string) {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    do {
      const page = await this.listBitableRecords(tableId, 500, pageToken);
      for (const item of page.items ?? []) {
        const recordId = String((item as any).record_id ?? "");
        if (recordId) ids.add(recordId);
      }
      pageToken = page.has_more ? page.page_token : undefined;
    } while (pageToken);
    return ids;
  }

  async listAllBitableRecords(tableId: string) {
    const records: Array<Record<string, unknown>> = [];
    let pageToken: string | undefined;
    do {
      const page = await this.listBitableRecords(tableId, 500, pageToken);
      records.push(...(page.items ?? []));
      pageToken = page.has_more ? page.page_token : undefined;
    } while (pageToken);
    return records;
  }

  tableIdForType(typeKey: string) {
    if (typeKey === "demand") return config.feishu.demandTableId;
    if (typeKey === "issue") return config.feishu.issueTableId;
    if (typeKey === "system_owner") return config.feishu.systemOwnerTableId;
    return "";
  }

  async createBitableRecord(tableId: string, fields: Record<string, unknown>) {
    return this.bitableRequest<{ record: { record_id: string; fields: Record<string, unknown> } }>(`/tables/${tableId}/records`, {
      method: "POST",
      body: JSON.stringify({ fields })
    });
  }

  async updateBitableRecord(tableId: string, recordId: string, fields: Record<string, unknown>) {
    return this.bitableRequest<{ record: { record_id: string; fields: Record<string, unknown> } }>(`/tables/${tableId}/records/${recordId}`, {
      method: "PUT",
      body: JSON.stringify({ fields })
    });
  }

  async deleteBitableRecord(tableId: string, recordId: string) {
    return this.bitableRequest<Record<string, unknown>>(`/tables/${tableId}/records/${recordId}`, {
      method: "DELETE"
    });
  }

  async uploadBitableAttachment(input: { buffer: Buffer; fileName: string; mimeType?: string }) {
    if (!config.feishu.bitableAppToken) {
      throw new Error("FEISHU_BITABLE_APP_TOKEN is not configured.");
    }
    const token = await this.getTenantAccessToken();
    const form = new FormData();
    form.set("file_name", input.fileName);
    form.set("parent_type", "bitable_file");
    form.set("parent_node", config.feishu.bitableAppToken);
    form.set("size", String(input.buffer.length));
    const body = input.buffer.buffer.slice(input.buffer.byteOffset, input.buffer.byteOffset + input.buffer.byteLength) as ArrayBuffer;
    form.set("file", new Blob([body], { type: input.mimeType ?? "application/octet-stream" }), input.fileName);

    const response = await fetch("https://open.feishu.cn/open-apis/drive/v1/medias/upload_all", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      },
      body: form
    });
    const data = await response.json() as { code: number; msg?: string; data?: { file_token?: string } };
    if (!response.ok || data.code !== 0 || !data.data?.file_token) {
      throw new Error(`Feishu bitable attachment upload failed: ${data.msg ?? response.statusText}`);
    }
    return {
      fileToken: data.data.file_token
    };
  }

  async downloadBitableAttachment(fileToken: string) {
    if (!config.feishu.bitableAppToken) {
      throw new Error("FEISHU_BITABLE_APP_TOKEN is not configured.");
    }
    const token = await this.getTenantAccessToken();
    const response = await fetch(`https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`
      }
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Feishu attachment download failed: ${text || response.statusText}`);
    }
    return response;
  }

  async bitableStatus() {
    const status = {
      appTokenConfigured: Boolean(config.feishu.bitableAppToken),
      tableIds: {
        demand: Boolean(config.feishu.demandTableId),
        issue: Boolean(config.feishu.issueTableId),
        systemOwner: Boolean(config.feishu.systemOwnerTableId)
      },
      tablesOk: false,
      tables: [] as Array<{ table_id: string; name: string }>,
      message: ""
    };
    if (!config.feishu.bitableAppToken) {
      return {
        ...status,
        message: "FEISHU_BITABLE_APP_TOKEN 未配置。"
      };
    }
    try {
      const tables = await this.listBitableTables();
      return {
        ...status,
        tablesOk: true,
        tables: tables.items ?? [],
        message: "飞书多维表格连接成功。"
      };
    } catch (error) {
      return {
        ...status,
        message: error instanceof Error ? error.message : "飞书多维表格连接失败。"
      };
    }
  }
}

export const feishuService = new FeishuService();
