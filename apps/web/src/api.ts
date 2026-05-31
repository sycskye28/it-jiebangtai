import type { FieldConfig, FormType, RecordDetail, RecordSummary, CurrentUser } from "@it/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

function headerSafe(value: string) {
  return encodeURIComponent(value);
}

export function storeCurrentUser(user: CurrentUser) {
  localStorage.setItem("devUserId", user.feishuUserId);
  localStorage.setItem("devUserName", user.name);
  localStorage.setItem("devRole", user.role);
}

async function request<T>(path: string, options: RequestInit = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { "content-type": "application/json" }),
      "x-dev-user-id": localStorage.getItem("devUserId") ?? "dev-admin",
      "x-dev-user-name": headerSafe(localStorage.getItem("devUserName") ?? "彭涛"),
      "x-dev-role": localStorage.getItem("devRole") ?? "business",
      ...(options.headers ?? {})
    }
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.detail ?? error.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  me: () => request<CurrentUser>("/api/auth/me"),
  feishuOAuthUrl: () => request<{ configured: boolean; redirectUri: string; url: string }>("/api/auth/feishu/oauth-url"),
  loginFeishu: (code: string) => request<{ user: CurrentUser }>("/api/auth/feishu/login", {
    method: "POST",
    body: JSON.stringify({ code })
  }),
  formTypes: () => request<FormType[]>("/api/form-types"),
  formConfig: (typeKey: string) => request<{ formType: FormType; fields: FieldConfig[] }>(`/api/forms/${typeKey}/config`),
  records: () => request<RecordSummary[]>("/api/records"),
  record: (id: string) => request<RecordDetail>(`/api/records/${id}`),
  createRecord: (typeKey: string, values: Record<string, unknown>) => request<RecordSummary>(`/api/records/${typeKey}`, {
    method: "POST",
    body: JSON.stringify({ values })
  }),
  updateRecord: (id: string, values: Record<string, unknown>) => request<RecordSummary>(`/api/records/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ values })
  }),
  addComment: (id: string, body: string) => request(`/api/records/${id}/comments`, {
    method: "POST",
    body: JSON.stringify({ body })
  }),
  uploadAttachment: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return request<{ name: string; storedName: string; mimeType: string; size: number; url: string; fileToken?: string; feishuError?: string }>("/api/uploads", {
      method: "POST",
      body: formData
    });
  },
  owners: () => request<Array<{ id: string; systemName: string; ownerName: string; consultantNames: string | null }>>("/api/system-owners"),
  fieldConfigs: () => request<any[]>("/api/admin/field-configs"),
  createFormType: (values: Record<string, unknown>) => request<any>("/api/admin/form-types", {
    method: "POST",
    body: JSON.stringify(values)
  }),
  createFieldConfig: (values: Record<string, unknown>) => request<any>("/api/admin/field-configs", {
    method: "POST",
    body: JSON.stringify(values)
  }),
  updateFieldConfig: (id: string, values: Record<string, unknown>) => request<any>(`/api/admin/field-configs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(values)
  }),
  syncBitableSchema: () => request<{
    disabledFormTypes: string[];
    importedFormTypes: string[];
    syncedFields: number;
    createdFields: number;
    removedFields: number;
  }>("/api/admin/feishu/sync-from-bitable", {
    method: "POST",
    body: JSON.stringify({})
  }),
  accessRequests: () => request<any[]>("/api/admin/access-requests")
};
