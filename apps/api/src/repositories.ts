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

export async function upsertFeishuLoginUser(userInfo: Record<string, unknown>) {
  const openId = String(userInfo.open_id ?? userInfo.openId ?? "");
  const userId = String(userInfo.user_id ?? userInfo.userId ?? userInfo.employee_no ?? userInfo.employeeNo ?? openId);
  const unionId = userInfo.union_id ? String(userInfo.union_id) : null;
  const employeeNo = userInfo.employee_no ? String(userInfo.employee_no) : userId;
  const name = String(userInfo.name ?? userInfo.en_name ?? employeeNo ?? userId);
  const avatarUrl = userInfo.avatar_url ? String(userInfo.avatar_url) : null;

  if (!userId && !openId) {
    throw new Error("Feishu user info does not contain user_id or open_id.");
  }

  const result = await query<DbUser>(
    `INSERT INTO users (feishu_user_id, feishu_open_id, feishu_union_id, employee_no, name, avatar_url, role, access_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'business', 'active')
     ON CONFLICT (feishu_user_id) DO UPDATE
       SET feishu_open_id = EXCLUDED.feishu_open_id,
           feishu_union_id = EXCLUDED.feishu_union_id,
           employee_no = EXCLUDED.employee_no,
           name = EXCLUDED.name,
           avatar_url = EXCLUDED.avatar_url,
           updated_at = now()
     RETURNING *`,
    [userId || openId, openId || null, unionId, employeeNo || null, name, avatarUrl]
  );

  return toAuthUser(result.rows[0]);
}

function decodeHeaderValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function ensureDevUser(headers: Record<string, string | string[] | undefined>) {
  const feishuUserId = String(headers["x-dev-user-id"] ?? "dev-admin");
  const name = decodeHeaderValue(String(headers["x-dev-user-name"] ?? "%E5%BD%AD%E6%B6%9B"));
  const department = decodeHeaderValue(String(headers["x-dev-department"] ?? "IT"));
  const role = String(headers["x-dev-role"] ?? "admin") as AuthUser["role"];

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
            editable_by_business, internal, show_in_list, sort_order, options, feishu_field_name
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
  if (user.role === "system_owner") return record.owner_name === user.name;
  return record.submitter_user_id === user.id;
}
