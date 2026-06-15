import type pg from "pg";
import { config } from "./config.js";
import { query } from "./db.js";
import type { AuthUser } from "./types.js";

type DbUser = {
  id: string;
  feishu_user_id: string;
  feishu_open_id?: string | null;
  feishu_union_id?: string | null;
  employee_no?: string | null;
  name: string;
  department: string | null;
  role: AuthUser["role"];
  access_status: AuthUser["accessStatus"];
};

export function toAuthUser(row: DbUser): AuthUser {
  return {
    id: row.id,
    feishuUserId: row.feishu_user_id,
    name: row.name,
    department: row.department,
    role: row.role,
    accessStatus: row.access_status
  };
}

function isSuperAdminIdentity(feishuUserId: string, employeeNo?: string | null, name?: string | null) {
  const normalizedId = feishuUserId.trim().toLowerCase();
  const normalizedEmployeeNo = String(employeeNo ?? "").trim().toLowerCase();
  return normalizedId === "a10986" || normalizedEmployeeNo === "a10986" || name === "沈昀初";
}

async function isAdminMemberIdentity(feishuUserId: string, employeeNo?: string | null, name?: string | null) {
  const ids = [feishuUserId, employeeNo].map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean);
  const normalizedName = String(name ?? "").trim();
  const result = await query(
    `SELECT id
       FROM admin_members
      WHERE enabled = true
        AND (
          lower(COALESCE(feishu_user_id, '')) = ANY($1::text[])
          OR lower(COALESCE(employee_no, '')) = ANY($1::text[])
          OR name = $2
        )
      LIMIT 1`,
    [ids, normalizedName]
  );
  return Boolean(result.rows[0]);
}

export async function upsertFeishuLoginUser(userInfo: Record<string, unknown>) {
  const openId = String(userInfo.open_id ?? userInfo.openId ?? "");
  const userId = String(userInfo.user_id ?? userInfo.userId ?? userInfo.employee_no ?? userInfo.employeeNo ?? openId);
  const unionId = userInfo.union_id ? String(userInfo.union_id) : null;
  const employeeNo = userInfo.employee_no ? String(userInfo.employee_no) : userId;
  const name = String(userInfo.name ?? userInfo.en_name ?? employeeNo ?? userId);
  const department = userInfo.department
    ? String(userInfo.department)
    : userInfo.department_name
      ? String(userInfo.department_name)
      : userInfo.departmentName
        ? String(userInfo.departmentName)
        : null;
  const avatarUrl = userInfo.avatar_url ? String(userInfo.avatar_url) : null;
  const role: AuthUser["role"] = isSuperAdminIdentity(userId || openId, employeeNo, name)
    ? "admin"
    : await isAdminMemberIdentity(userId || openId, employeeNo, name)
      ? "system_owner"
      : "business";

  if (!userId && !openId) {
    throw new Error("Feishu user info does not contain user_id or open_id.");
  }

  const result = await query<DbUser>(
    `INSERT INTO users (feishu_user_id, feishu_open_id, feishu_union_id, employee_no, name, department, avatar_url, role, access_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
     ON CONFLICT (feishu_user_id) DO UPDATE
       SET feishu_open_id = EXCLUDED.feishu_open_id,
           feishu_union_id = EXCLUDED.feishu_union_id,
           employee_no = EXCLUDED.employee_no,
           name = EXCLUDED.name,
           department = EXCLUDED.department,
           avatar_url = EXCLUDED.avatar_url,
           role = EXCLUDED.role,
           updated_at = now()
     RETURNING *`,
    [userId || openId, openId || null, unionId, employeeNo || null, name, department, avatarUrl, role]
  );

  return toAuthUser(result.rows[0]);
}

export async function storeFeishuUserAccessToken(feishuUserId: string, accessToken: string, expiresInSeconds: number) {
  const expiresAt = new Date(Date.now() + Math.max(60, expiresInSeconds - 120) * 1000);
  await query(
    `UPDATE users
        SET feishu_user_access_token = $2,
            feishu_user_token_expires_at = $3,
            updated_at = now()
      WHERE feishu_user_id = $1`,
    [feishuUserId, accessToken, expiresAt]
  );
}

export async function getValidFeishuUserAccessToken(userId: string) {
  const result = await query<{ feishu_user_access_token: string }>(
    `SELECT feishu_user_access_token
       FROM users
      WHERE id = $1
        AND feishu_user_access_token IS NOT NULL
        AND feishu_user_token_expires_at > now()
      LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.feishu_user_access_token ?? null;
}

function decodeHeaderValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function ensureDevUser(headers: Record<string, string | string[] | undefined>) {
  const feishuUserId = String(headers["x-dev-user-id"] ?? "anonymous");
  const name = decodeHeaderValue(String(headers["x-dev-user-name"] ?? "%E6%9C%AA%E7%99%BB%E5%BD%95%E7%94%A8%E6%88%B7"));
  const department = decodeHeaderValue(String(headers["x-dev-department"] ?? ""));
  const requestedRole = String(headers["x-dev-role"] ?? "");
  const isSimulation = requestedRole === "business" || requestedRole === "system_owner";
  const role: AuthUser["role"] = !isSimulation && isSuperAdminIdentity(feishuUserId, feishuUserId, name)
    ? "admin"
    : requestedRole === "external"
      ? "external"
      : isSimulation
        ? requestedRole
      : await isAdminMemberIdentity(feishuUserId, feishuUserId, name)
        ? "system_owner"
        : "business";

  const result = await query<DbUser>(
    `INSERT INTO users (feishu_user_id, name, department, role, access_status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (feishu_user_id) DO UPDATE
       SET name = EXCLUDED.name,
           department = EXCLUDED.department,
           role = EXCLUDED.role,
           updated_at = now()
     RETURNING *`,
    [feishuUserId, name, department, role]
  );

  return toAuthUser(result.rows[0]);
}

export async function getFormTypes() {
  const result = await query(
    `SELECT id, key, name, description, title_field_key, system_field_key,
            submitter_field_key, status_field_key, enabled
       FROM form_types
      WHERE enabled = true
      ORDER BY sort_order, name`
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    titleFieldKey: row.title_field_key,
    systemFieldKey: row.system_field_key,
    submitterFieldKey: row.submitter_field_key,
    statusFieldKey: row.status_field_key,
    enabled: row.enabled
  }));
}

export async function getFormType(typeKey: string, client?: pg.PoolClient) {
  const runner = client ?? { query: query as any };
  const result = await runner.query(
    `SELECT id, key, name, description, title_field_key, system_field_key,
            submitter_field_key, status_field_key, enabled
       FROM form_types
      WHERE key = $1`,
    [typeKey]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    titleFieldKey: row.title_field_key,
    systemFieldKey: row.system_field_key,
    submitterFieldKey: row.submitter_field_key,
    statusFieldKey: row.status_field_key,
    enabled: row.enabled
  };
}

export async function getFieldConfigs(typeKey: string) {
  const result = await query(
    `SELECT id, form_type_key, field_key, label, kind, required, visible_to_business,
            editable_by_business, business_visible, internal, show_in_list, sort_order, options, feishu_field_name
       FROM field_configs
      WHERE form_type_key = $1
      ORDER BY sort_order, label`,
    [typeKey]
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    formTypeKey: row.form_type_key,
    fieldKey: row.field_key,
    label: row.label,
    kind: row.kind,
    required: row.required,
    visibleToBusiness: row.visible_to_business,
    editableByBusiness: row.editable_by_business,
    businessVisible: row.business_visible,
    internal: row.internal,
    showInList: row.show_in_list,
    sortOrder: row.sort_order,
    options: row.options ?? [],
    feishuFieldName: row.feishu_field_name ?? undefined
  }));
}

export async function getFieldMap(typeKey: string, client?: pg.PoolClient) {
  const runner = client ?? { query: query as any };
  const result = await runner.query(
    `SELECT field_key, feishu_field_name
       FROM field_configs
      WHERE form_type_key = $1
        AND feishu_field_name IS NOT NULL
      ORDER BY sort_order`,
    [typeKey]
  );
  return result.rows.reduce((map: Record<string, string>, row: any) => {
    map[row.field_key] = row.feishu_field_name;
    return map;
  }, {});
}

export function toFeishuFields(values: Record<string, unknown>, fieldMap: Record<string, string>) {
  return Object.entries(values).reduce((fields: Record<string, unknown>, [fieldKey, value]) => {
    const feishuFieldName = fieldMap[fieldKey];
    if (!feishuFieldName) return fields;
    if (value === undefined || value === null || value === "") return fields;
    fields[feishuFieldName] = value;
    return fields;
  }, {});
}

export async function getOwnerForSystem(systemName: string, client?: pg.PoolClient) {
  const runner = client ?? { query: query as any };
  const result = await runner.query(
    `SELECT system_name, owner_name, owner_feishu_user_id, consultant_names
       FROM system_owners
      WHERE enabled = true AND system_name = $1`,
    [systemName]
  );
  if (result.rows[0]) {
    return {
      systemName: result.rows[0].system_name,
      ownerName: result.rows[0].owner_name,
      ownerFeishuUserId: result.rows[0].owner_feishu_user_id,
      consultantNames: result.rows[0].consultant_names
    };
  }
  return {
    systemName,
    ownerName: config.defaultAdminName,
    ownerFeishuUserId: config.defaultAdminUserId || null,
    consultantNames: null
  };
}

export async function listSystemOwners() {
  const result = await query(
    `SELECT id, system_name, owner_name, owner_feishu_user_id, consultant_names, enabled
       FROM system_owners
      ORDER BY system_name`
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    systemName: row.system_name,
    ownerName: row.owner_name,
    ownerFeishuUserId: row.owner_feishu_user_id,
    consultantNames: row.consultant_names,
    enabled: row.enabled
  }));
}

export function canViewRecord(user: AuthUser, record: any) {
  if (user.role === "admin") return true;
  if (user.role === "system_owner") return true;
  return true;
}
