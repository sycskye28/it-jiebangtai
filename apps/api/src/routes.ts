import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import AdmZip from "adm-zip";
import { z } from "zod";
import {
  createRecordSchema,
  updateRecordSchema,
  accessRequestSchema,
  innovationArticleInputSchema,
  innovationAwardInputSchema,
  innovationProjectInputSchema,
  innovationStatusSchema,
  innovationSupplementInputSchema
} from "@it/shared";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { feishuService } from "./feishu.js";
import {
  canViewRecord,
  getFieldConfigs,
  getFeishuUserTokenState,
  getFormType,
  getFormTypes,
  getValidFeishuUserAccessToken,
  getOwnerForSystem,
  listSystemOwners,
  storeFeishuUserTokens,
} from "./repositories.js";

const adminOnly = (role: string) => {
  if (role !== "admin") {
    const error = new Error("Only administrators can perform this action.");
    (error as any).statusCode = 403;
    throw error;
  }
};

const systemWorkerOnly = (role: string) => {
  if (!["admin", "system_owner"].includes(role)) {
    const error = new Error("Only IT administrators can perform this action.");
    (error as any).statusCode = 403;
    throw error;
  }
};

async function generateRecordNo(client: any, typeKey: string, typeName: string) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date()).replace(/-/g, "");
  const counterKey = `${typeKey}:${today}`;
  const result = await client.query(
    `INSERT INTO record_counters (counter_key, seq)
     VALUES ($1, 1)
     ON CONFLICT (counter_key) DO UPDATE
       SET seq = record_counters.seq + 1,
           updated_at = now()
     RETURNING seq`,
    [counterKey]
  );
  return `${typeName}-${today}-${String(result.rows[0].seq).padStart(3, "0")}`;
}

function dateToFeishuTimestamp(value: unknown) {
  if (!value) return null;
  if (typeof value === "number") return value;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return new Date(`${text}T00:00:00+08:00`).getTime();
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function attachmentToFeishu(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).fileToken : null)
    .filter((fileToken): fileToken is string => typeof fileToken === "string" && fileToken.length > 0)
    .map((fileToken) => ({ file_token: fileToken }));
}

function numberToFeishu(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function bitableFieldType(kind: string) {
  const types: Record<string, number> = {
    text: 1,
    textarea: 1,
    person: 1,
    select: 3,
    number: 2,
    date: 5,
    boolean: 7,
    attachment: 17
  };
  return types[kind] ?? 1;
}

function kindFromBitableFieldType(type: unknown) {
  const normalized = Number(type);
  if (normalized === 2) return "number";
  if (normalized === 3) return "select";
  if (normalized === 5) return "date";
  if (normalized === 7) return "boolean";
  if (normalized === 17) return "attachment";
  return "text";
}

function bitableFieldProperty(kind: string, options: string[]) {
  if (kind === "select" && options.length) return { options: options.map((name) => ({ name })) };
  return null;
}

function bitableValueToString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => bitableValueToString(item)).filter(Boolean).join("、");
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["text", "name", "value", "en_name", "file_name", "url", "link"]) {
      if (object[key] !== undefined && object[key] !== null) return bitableValueToString(object[key]);
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function bitableValueToAppValue(kind: string, value: unknown) {
  if (value === undefined || value === null) return "";
  if (kind === "date") {
    const timestamp = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date(timestamp));
    }
    return bitableValueToString(value);
  }
  if (kind === "attachment" && Array.isArray(value)) {
    return value.map((item) => {
      if (!item || typeof item !== "object") return { name: bitableValueToString(item), url: "", fileToken: "" };
      const object = item as Record<string, unknown>;
      return {
        name: String(object.name ?? object.file_name ?? object.fileName ?? object.file_token ?? "附件"),
        url: String(object.url ?? ""),
        fileToken: String(object.file_token ?? object.fileToken ?? "")
      };
    });
  }
  if (kind === "number") return numberToFeishu(value);
  if (kind === "boolean") return Boolean(value);
  return bitableValueToString(value);
}

function safeDownloadName(value: unknown) {
  const fallback = "attachment";
  const name = String(value || fallback).replace(/[\r\n"]/g, "_");
  return name.trim() || fallback;
}

function xmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function extractDocxPreview(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    const error = new Error("当前文件不是有效的 .docx Word 文档，请确认不是 .doc、PDF 或网页下载文件。");
    (error as any).statusCode = 400;
    throw error;
  }
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    const error = new Error("Word 文档解析失败，请重新另存为 .docx 后再上传。");
    (error as any).statusCode = 400;
    throw error;
  }
  const documentEntry = zip.getEntry("word/document.xml");
  if (!documentEntry) {
    const error = new Error("Word 文档结构不完整，未找到正文内容，请重新另存为 .docx 后再上传。");
    (error as any).statusCode = 400;
    throw error;
  }
  const xml = documentEntry.getData().toString("utf8");
  const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs
    .map((paragraph) => {
      const runs = [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
      return runs.map((run) => xmlText(run[1] ?? "")).join("");
    })
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function uploadMimeType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".png") return "image/png";
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

function extractDocxImages(buffer: Buffer) {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return [];
  }
  return zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && /^word\/media\/[^/]+\.(png|jpe?g|gif|webp|svg)$/i.test(entry.entryName))
    .map((entry, index) => {
      const originalName = path.basename(entry.entryName);
      const extension = path.extname(originalName).toLowerCase();
      const storedName = `${Date.now()}-${randomUUID()}-word-image-${index + 1}${extension}`;
      const buffer = entry.getData();
      return {
        name: originalName,
        storedName,
        mimeType: uploadMimeType(originalName),
        size: buffer.length,
        buffer,
        url: `/api/uploads/${storedName}`,
        source: "word_image"
      };
    });
}

function todayInChina() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function dateTimeInChina(value: string | Date | number = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function submissionTimelineBody(input: {
  submitterName: string;
  submittedAt: string | Date | number;
  ownerName?: string | null;
  extra?: string | null;
}) {
  return [
    `提交人：${input.submitterName}`,
    `提交时间：${dateTimeInChina(input.submittedAt)}`,
    input.ownerName ? `自动分派给：${input.ownerName}` : null,
    input.extra || null
  ].filter(Boolean).join("\n");
}

function applySubmissionAutoFields(
  values: Record<string, unknown>,
  fields: Array<{ fieldKey: string; label: string }>,
  formType: { submitterFieldKey: string },
  user: { name: string; feishuUserId: string }
) {
  const next = { ...values };
  const submitterKeys = new Set<string>([formType.submitterFieldKey, "submitter"]);
  const submittedAtKeys = new Set<string>(["submitted_at"]);
  for (const field of fields) {
    if (/(提交人|提出人|申请人)$/u.test(field.label)) submitterKeys.add(field.fieldKey);
    if (/(提交时间|提出时间|申请时间)$/u.test(field.label)) submittedAtKeys.add(field.fieldKey);
  }
  for (const key of submitterKeys) next[key] = user.name;
  for (const key of submittedAtKeys) next[key] = todayInChina();
  next.submitter_user_id = user.feishuUserId;
  next.submitter_feishu_user_id = user.feishuUserId;
  return next;
}

const workflowStatusRules = [
  {
    status: "部署已完成",
    patterns: [/部署.*(完成|上线|时间|日期)/u, /上线.*(完成|时间|日期)/u, /deploy/i, /release/i, /launch/i]
  },
  {
    status: "测试已完成",
    patterns: [/测试.*(完成|时间|日期)/u, /test/i, /testing/i]
  },
  {
    status: "开发已完成",
    patterns: [/开发.*(完成|时间|日期)/u, /develop/i, /development/i]
  },
  {
    status: "设计已完成",
    patterns: [/设计.*(完成|时间|日期)/u, /design/i]
  }
];

function hasWorkflowValue(value: unknown) {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function statusFromWorkflowValues(
  values: Record<string, unknown>,
  fields: Array<{ fieldKey: string; label: string }>,
  changedKeys: string[] = [],
  statusFieldKey = "status"
) {
  const descriptors = fields.map((field) => ({
    key: field.fieldKey,
    label: field.label,
    text: `${field.fieldKey} ${field.label}`
  }));
  for (const rule of workflowStatusRules) {
    const matchedField = descriptors.find((field) => (
      rule.patterns.some((pattern) => pattern.test(field.text)) && hasWorkflowValue(values[field.key])
    ));
    if (matchedField) {
      return rule.status;
    }
  }
  const changedBusinessFields = changedKeys.filter((key) => key !== statusFieldKey);
  if (changedBusinessFields.length) return "处理中";
  return null;
}

function recordTypeTitle(typeKey: string, formTypeName?: string | null) {
  if (formTypeName) return formTypeName;
  if (typeKey === "demand") return "需求";
  if (typeKey === "issue") return "问题";
  return "记录";
}

function optionsFromBitableField(field: Record<string, unknown>) {
  const property = field.property as Record<string, unknown> | undefined;
  const options = property?.options;
  if (!Array.isArray(options)) return [];
  return options.map((option) => {
    if (option && typeof option === "object") return String((option as Record<string, unknown>).name ?? "");
    return String(option ?? "");
  }).filter(Boolean);
}

function fieldKeyFromLabel(label: string) {
  const normalized = label
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  return normalized || `field_${randomUUID().slice(0, 8)}`;
}

function formTypeKeyFromTable(tableId: string) {
  return `bitable_${tableId.slice(-8).replace(/[^a-zA-Z0-9_]/g, "").toLowerCase()}`;
}

function cleanFormTypeName(tableName: string) {
  return tableName.replace(/记录表$/u, "") || tableName;
}

async function tableIdForType(typeKey: string) {
  const formType = await query<{ feishu_table_id: string | null }>("SELECT feishu_table_id FROM form_types WHERE key = $1", [typeKey]);
  return formType.rows[0]?.feishu_table_id || feishuService.tableIdForType(typeKey);
}

function builtinTypeForTableId(tableId: string) {
  if (tableId === config.feishu.demandTableId) return "demand";
  if (tableId === config.feishu.issueTableId) return "issue";
  if (tableId === config.feishu.innovationTableId) return INNOVATION_TYPE_KEY;
  return null;
}

function isManagedNonRecordTable(tableId: string) {
  return tableId === config.feishu.systemOwnerTableId;
}

async function recordValuesToFeishuFields(typeKey: string, values: Record<string, unknown>) {
  const configs = await getFieldConfigs(typeKey);
  const fields: Record<string, unknown> = {};
  for (const field of configs) {
    if (!field.feishuFieldName) continue;
    const value = values[field.fieldKey];
    if (value === undefined || value === null || value === "") continue;
    if (field.kind === "date") {
      const timestamp = dateToFeishuTimestamp(value);
      if (timestamp !== null) fields[field.feishuFieldName] = timestamp;
      continue;
    }
    if (field.kind === "attachment") {
      const attachments = attachmentToFeishu(value);
      if (Array.isArray(value)) fields[field.feishuFieldName] = attachments;
      continue;
    }
    if (field.kind === "number") {
      const numberValue = numberToFeishu(value);
      if (numberValue !== null) fields[field.feishuFieldName] = numberValue;
      continue;
    }
    if (value && typeof value === "object") {
      fields[field.feishuFieldName] = JSON.stringify(value);
    } else {
      fields[field.feishuFieldName] = value;
    }
  }
  return fields;
}

function summarizeRecord(row: any) {
  const values = row.values ?? {};
  return {
    id: row.id,
    recordNo: row.record_no ?? null,
    typeKey: row.type_key,
    title: row.title,
    systemName: row.system_name,
    status: row.status,
    priority: row.priority,
    submitterUserId: row.submitter_user_id ?? null,
    submitterFeishuUserId: values.submitter_feishu_user_id ?? null,
    submitterName: row.submitter_name,
    ownerName: row.owner_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function visibleValuesForUser(user: any, record: any) {
  return record.values;
}

async function tryCreateFeishuRecord(record: any) {
  const tableId = await tableIdForType(record.type_key);
  if (!tableId || record.feishu_record_id) return;
  try {
    const fields = await recordValuesToFeishuFields(record.type_key, record.values ?? {});
    const result = await feishuService.createBitableRecord(tableId, fields);
    const feishuRecordId = result.record.record_id;
    await query("UPDATE records SET feishu_record_id = $2 WHERE id = $1", [record.id, feishuRecordId]);
    await query(
      `INSERT INTO timeline_events (record_id, event_type, title, body)
       VALUES ($1, 'feishu_synced', '已同步飞书多维表格', $2)`,
      [record.id, feishuRecordId]
    );
  } catch (error) {
    await query(
      `INSERT INTO timeline_events (record_id, event_type, title, body)
       VALUES ($1, 'feishu_sync_failed', '飞书多维表格同步失败', $2)`,
      [record.id, error instanceof Error ? error.message : "未知错误"]
    );
  }
}

async function tryUpdateFeishuRecord(record: any) {
  const tableId = await tableIdForType(record.type_key);
  if (!tableId || !record.feishu_record_id) return;
  try {
    const fields = await recordValuesToFeishuFields(record.type_key, record.values ?? {});
    await feishuService.updateBitableRecord(tableId, record.feishu_record_id, fields);
    await query(
      `INSERT INTO timeline_events (record_id, event_type, title, body)
       VALUES ($1, 'feishu_synced', '已更新飞书多维表格', $2)`,
      [record.id, record.feishu_record_id]
    );
  } catch (error) {
    await query(
      `INSERT INTO timeline_events (record_id, event_type, title, body)
       VALUES ($1, 'feishu_sync_failed', '飞书多维表格更新失败', $2)`,
      [record.id, error instanceof Error ? error.message : "未知错误"]
    );
  }
}

async function deleteFeishuRecord(typeKey: string, recordId: string | null) {
  if (!recordId) return;
  const candidateTableIds = new Set<string>();
  const primaryTableId = await tableIdForType(typeKey);
  if (primaryTableId) candidateTableIds.add(primaryTableId);
  const localTables = await query<{ feishu_table_id: string | null }>(
    "SELECT feishu_table_id FROM form_types WHERE enabled=true AND feishu_table_id IS NOT NULL"
  );
  for (const row of localTables.rows) {
    if (row.feishu_table_id) candidateTableIds.add(row.feishu_table_id);
  }
  try {
    const remoteTables = await feishuService.listBitableTables();
    for (const table of remoteTables.items ?? []) {
      if (!isManagedNonRecordTable(table.table_id)) candidateTableIds.add(table.table_id);
    }
  } catch {
    // Local table ids are enough for normal operation; remote listing is just a fallback.
  }

  let lastMeaningfulError: unknown = null;
  for (const tableId of candidateTableIds) {
    try {
      await feishuService.deleteBitableRecord(tableId, recordId);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/BadRequest|not\s*exist|not\s*found|not\s*exists|record.*not|RecordIdNotFound|RecordNotExist/i.test(message)) {
        continue;
      }
      lastMeaningfulError = error;
    }
  }
  if (lastMeaningfulError) throw lastMeaningfulError;
}

async function cleanupFeishuRecordFallback(record: any) {
  const tables = await feishuService.listBitableTables();
  const title = String(record.title ?? "");
  const deletedIds = new Set<string>();
  const errors: string[] = [];

  for (const table of tables.items ?? []) {
    if (isManagedNonRecordTable(table.table_id)) continue;
    try {
      const remoteRecords = await feishuService.listAllBitableRecords(table.table_id);
      for (const remoteRecord of remoteRecords) {
        const remoteId = String((remoteRecord as any).record_id ?? "");
        const fields = ((remoteRecord as any).fields ?? {}) as Record<string, unknown>;
        const fieldValues = Object.values(fields).map((value) => bitableValueToString(value));
        const matchesStoredId = record.feishu_record_id && remoteId === record.feishu_record_id;
        const matchesExactTitle = title && fieldValues.includes(title);
        if (!remoteId || deletedIds.has(remoteId) || (!matchesStoredId && !matchesExactTitle)) continue;
        await feishuService.deleteBitableRecord(table.table_id, remoteId);
        deletedIds.add(remoteId);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { deletedCount: deletedIds.size, errors };
}

let feishuNotificationsDisabled = config.feishu.notificationsDisabled;

async function trySendNotification(recordId: string | null, payload: Parameters<typeof feishuService.sendNotification>[0]) {
  if (feishuNotificationsDisabled) {
    console.info("[feishu:notification-muted]", {
      recordId,
      title: payload.title,
      submitterFeishuUserId: payload.submitterFeishuUserId,
      ownerFeishuUserId: payload.ownerFeishuUserId,
      extraFeishuUserIds: payload.extraFeishuUserIds
    });
    return;
  }
  try {
    await feishuService.sendNotification(payload);
  } catch (error) {
    if (!recordId) return;
    await query(
      `INSERT INTO timeline_events (record_id, event_type, title, body)
       VALUES ($1, 'feishu_notification_failed', '飞书消息通知失败', $2)`,
      [recordId, error instanceof Error ? error.message : "未知错误"]
    );
  }
}

function normalizeManualFeishuUserId(providedUserId?: string | null) {
  return String(providedUserId ?? "").trim() || null;
}

async function searchFeishuUsersForRequest(request: any, queryParams: { query: string; pageSize: number; pageToken?: string }) {
  let token = await getValidFeishuUserAccessToken(request.user.id);
  if (!token) {
    const tokenState = await getFeishuUserTokenState(request.user.id);
    const refreshTokenValid = tokenState?.feishu_user_refresh_token
      && tokenState.feishu_user_refresh_expires_at
      && tokenState.feishu_user_refresh_expires_at > new Date();
    if (refreshTokenValid) {
      const refreshed = await feishuService.refreshUserAccessToken(tokenState.feishu_user_refresh_token!);
      await storeFeishuUserTokens({
        feishuUserId: request.user.feishuUserId,
        accessToken: refreshed.accessToken,
        expiresInSeconds: refreshed.expiresIn,
        refreshToken: refreshed.refreshToken,
        refreshExpiresInSeconds: refreshed.refreshExpiresIn
      });
      token = refreshed.accessToken;
    }
  }
  if (!token) {
    throw Object.assign(new Error("missing_user_token"), { statusCode: 400 });
  }
  return feishuService.searchUsers(token, {
    query: queryParams.query,
    pageSize: queryParams.pageSize,
    pageToken: queryParams.pageToken
  });
}

function isSuperAdminIdentityValue(feishuUserId?: string | null, employeeNo?: string | null, name?: string | null) {
  const normalizedUserId = String(feishuUserId ?? "").trim().toLowerCase();
  const normalizedEmployeeNo = String(employeeNo ?? "").trim().toLowerCase();
  return normalizedUserId === "a10986" || normalizedEmployeeNo === "a10986" || String(name ?? "").trim() === "沈昀初";
}

function toAdminMember(row: any) {
  return {
    id: row.id,
    name: row.name,
    feishuUserId: row.feishu_user_id,
    employeeNo: row.employee_no,
    role: row.role ?? "system_owner",
    note: row.note,
    enabled: row.enabled
  };
}

const INNOVATION_TYPE_KEY = "innovation_studio";
const INNOVATION_SYSTEM_NAME = "数字化创新工作室";
const INNOVATION_DEFAULT_STATUS = "待评审";
const INNOVATION_REJECTED_STATUS = "暂未入选（感谢你的创新提案）";
const innovationSupplementKeys = ["leader_name", "leader_user_id", "participants", "participants_user_ids", "workshop_resources", "expected_cost", "expected_cycle"] as const;

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function normalizedNumberText(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value).trim();
}

function canManageInnovation(role: string) {
  return role === "admin" || role === "system_owner";
}

function isInnovationRecord(record: any) {
  return record?.type_key === INNOVATION_TYPE_KEY;
}

function canSupplementInnovation(user: any, record: any) {
  if (canManageInnovation(user.role)) return true;
  return Boolean(
    record.submitter_user_id === user.id
      || record.submitter_name === user.name
      || (record.values ?? {}).submitter_feishu_user_id === user.feishuUserId
  );
}

function toInnovationAward(row: any) {
  return {
    id: row.id,
    recordId: row.record_id,
    awardName: row.award_name,
    awardType: row.award_type ?? null,
    reason: row.reason ?? null,
    displayOrder: Number(row.display_order ?? 0),
    awardedByName: row.awarded_by_name,
    awardedAt: row.awarded_at
  };
}

function toInnovationArticle(row: any) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? "",
    body: row.body ?? "",
    coverImageUrl: row.cover_image_url ?? null,
    attachments: row.attachments ?? [],
    status: row.status,
    authorName: row.author_name,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function awardsByRecordIds(recordIds: string[]) {
  if (!recordIds.length) return new Map<string, ReturnType<typeof toInnovationAward>[]>();
  const awardRows = await query<any>(
    `SELECT *
       FROM innovation_awards
      WHERE record_id = ANY($1::uuid[])
      ORDER BY display_order, awarded_at DESC`,
    [recordIds]
  );
  const grouped = new Map<string, ReturnType<typeof toInnovationAward>[]>();
  for (const row of awardRows.rows) {
    const list = grouped.get(row.record_id) ?? [];
    list.push(toInnovationAward(row));
    grouped.set(row.record_id, list);
  }
  return grouped;
}

async function toInnovationProject(row: any, options: { includeTimeline?: boolean } = {}) {
  const awards = await awardsByRecordIds([row.id]);
  let timeline: any[] | undefined;
  if (options.includeTimeline) {
    const timelineRows = await query<any>(
      `SELECT id, event_type, title, body, actor_name, created_at
         FROM timeline_events
        WHERE record_id=$1
        ORDER BY created_at`,
      [row.id]
    );
    timeline = timelineRows.rows.map((item) => ({
      id: item.id,
      eventType: item.event_type,
      title: item.title,
      body: item.body,
      actorName: item.actor_name,
      createdAt: item.created_at
    }));
  }
  const summary = summarizeRecord(row);
  return {
    id: summary.id,
    recordNo: summary.recordNo,
    title: summary.title,
    status: summary.status,
    submitterUserId: summary.submitterUserId,
    submitterFeishuUserId: summary.submitterFeishuUserId,
    submitterName: summary.submitterName,
    ownerName: summary.ownerName,
    values: row.values ?? {},
    awards: awards.get(row.id) ?? [],
    timeline,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt
  };
}

function mapInnovationInputToValues(input: z.infer<typeof innovationProjectInputSchema>) {
  return {
    project_theme: stringValue(input.projectTheme),
    project_description: stringValue(input.projectDescription),
    innovation_kind: input.innovationKind,
    leader_name: stringValue(input.leaderName),
    leader_user_id: normalizeManualFeishuUserId(input.leaderUserId),
    estimated_demand_cost: normalizedNumberText(input.estimatedDemandCost),
    studio_scope: INNOVATION_SYSTEM_NAME
  };
}

function innovationNotifyUserIds(values: Record<string, unknown>) {
  const leaderUserId = normalizeManualFeishuUserId(String(values.leader_user_id ?? ""));
  return [leaderUserId, ...config.feishu.innovationNotifyUserIds];
}

function mapInnovationSupplementToValues(input: z.infer<typeof innovationSupplementInputSchema>, allowStatus: boolean) {
  const values: Record<string, unknown> = {};
  if (input.leaderName !== undefined) values.leader_name = stringValue(input.leaderName);
  if (input.leaderUserId !== undefined) values.leader_user_id = normalizeManualFeishuUserId(input.leaderUserId);
  if (input.participants !== undefined) values.participants = stringValue(input.participants);
  if (input.participantsUserIds !== undefined) {
    values.participants_user_ids = (input.participantsUserIds ?? [])
      .map((id) => normalizeManualFeishuUserId(id))
      .filter(Boolean);
  }
  if (input.workshopResources !== undefined) values.workshop_resources = stringValue(input.workshopResources);
  if (input.expectedCost !== undefined) values.expected_cost = normalizedNumberText(input.expectedCost);
  if (input.expectedCycle !== undefined) values.expected_cycle = stringValue(input.expectedCycle);
  if (allowStatus && input.status !== undefined) values.status = input.status;
  return values;
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.get("/api/admin/feishu/notifications", async (request) => {
    adminOnly(request.user.role);
    return { disabled: feishuNotificationsDisabled };
  });

  app.patch("/api/admin/feishu/notifications", async (request) => {
    adminOnly(request.user.role);
    const body = z.object({ disabled: z.boolean() }).parse(request.body);
    feishuNotificationsDisabled = body.disabled;
    return { disabled: feishuNotificationsDisabled };
  });

  app.get("/api/uploads/:fileName", async (request, reply) => {
    const params = z.object({ fileName: z.string().min(1) }).parse(request.params);
    const queryParams = z.object({
      name: z.string().optional(),
      disposition: z.enum(["inline", "attachment"]).optional()
    }).parse(request.query);
    const safeName = path.basename(params.fileName);
    const filePath = path.join(config.uploadDir, safeName);
    await fsp.access(filePath);
    reply.header("content-type", uploadMimeType(safeName));
    reply.header(
      "content-disposition",
      `${queryParams.disposition === "attachment" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(safeDownloadName(queryParams.name ?? safeName))}`
    );
    return reply.send(fs.createReadStream(filePath));
  });

  app.get("/api/feishu/attachments/:fileToken/download", async (request, reply) => {
    const params = z.object({ fileToken: z.string().min(1) }).parse(request.params);
    const queryParams = z.object({
      name: z.string().optional(),
      disposition: z.enum(["inline", "attachment"]).optional()
    }).parse(request.query);
    const response = await feishuService.downloadBitableAttachment(params.fileToken);
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const downloadName = safeDownloadName(queryParams.name);
    reply.header("content-type", contentType);
    reply.header(
      "content-disposition",
      `${queryParams.disposition === "inline" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
    const contentLength = response.headers.get("content-length");
    if (contentLength) reply.header("content-length", contentLength);
    return reply.send(Readable.fromWeb(response.body as any));
  });

  app.post("/api/uploads", async (request) => {
    const file = await request.file();
    if (!file) return app.httpErrors.badRequest("No file uploaded.");
    await fsp.mkdir(config.uploadDir, { recursive: true });
    const extension = path.extname(file.filename || "");
    const safeOriginalName = path.basename(file.filename || "attachment").replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
    const storedName = `${Date.now()}-${randomUUID()}${extension}`;
    const filePath = path.join(config.uploadDir, storedName);
    const buffer = await file.toBuffer();
    if ((file as any).truncated) return app.httpErrors.badRequest("上传文件过大或传输不完整，请重新上传。");
    await fsp.writeFile(filePath, buffer);
    let feishu: { fileToken?: string; error?: string } = {};
    try {
      const uploaded = await feishuService.uploadBitableAttachment({
        buffer,
        fileName: safeOriginalName,
        mimeType: file.mimetype
      });
      feishu = { fileToken: uploaded.fileToken };
    } catch (error) {
      feishu = { error: error instanceof Error ? error.message : "飞书附件上传失败" };
    }
    return {
      name: safeOriginalName,
      storedName,
      mimeType: file.mimetype,
      size: buffer.length,
      url: `/api/uploads/${storedName}`
      ,
      fileToken: feishu.fileToken,
      feishuError: feishu.error
    };
  });

  app.get("/api/form-types", async () => getFormTypes());

  app.get("/api/forms/:typeKey/config", async (request) => {
    const params = z.object({ typeKey: z.string() }).parse(request.params);
    const formType = await getFormType(params.typeKey);
    if (!formType) return app.httpErrors.notFound("Unknown form type.");
    const fields = await getFieldConfigs(params.typeKey);
    return { formType, fields };
  });

  app.get("/api/system-owners", async () => listSystemOwners());

  app.get("/api/feishu/users/search", async (request) => {
    const queryParams = z.object({
      query: z.string().trim().min(1),
      pageSize: z.coerce.number().int().min(1).max(20).default(10),
      pageToken: z.string().optional()
    }).parse(request.query);
    return searchFeishuUsersForRequest(request, queryParams);
  });

  app.get("/api/innovation/projects", async () => {
    const result = await query<any>(
      `SELECT *
         FROM records
        WHERE type_key=$1
        ORDER BY updated_at DESC
        LIMIT 200`,
      [INNOVATION_TYPE_KEY]
    );
    const groupedAwards = await awardsByRecordIds(result.rows.map((row) => row.id));
    return result.rows.map((row) => {
      const summary = summarizeRecord(row);
      return {
        id: summary.id,
        recordNo: summary.recordNo,
        title: summary.title,
        status: summary.status,
        submitterUserId: summary.submitterUserId,
        submitterFeishuUserId: summary.submitterFeishuUserId,
        submitterName: summary.submitterName,
        ownerName: summary.ownerName,
        values: row.values ?? {},
        awards: groupedAwards.get(row.id) ?? [],
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt
      };
    });
  });

  app.get("/api/innovation/projects/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await query<any>("SELECT * FROM records WHERE id=$1 AND type_key=$2", [params.id, INNOVATION_TYPE_KEY]);
    if (!result.rows[0]) return app.httpErrors.notFound("Innovation project not found.");
    return toInnovationProject(result.rows[0], { includeTimeline: true });
  });

  app.post("/api/innovation/projects", async (request) => {
    const body = innovationProjectInputSchema.parse(request.body);
    const inputValues = mapInnovationInputToValues(body);
    if (body.innovationKind === "创新需求" && (!inputValues.leader_name || !inputValues.leader_user_id || !inputValues.estimated_demand_cost)) {
      return app.httpErrors.badRequest("创新需求需要选择牵头人并填写预计需求费用。");
    }

    const created = await withTransaction(async (client) => {
      const formType = await getFormType(INNOVATION_TYPE_KEY, client);
      if (!formType) throw app.httpErrors.badRequest("创新工作室表单类型未初始化，请先运行数据库迁移。");
      const fields = await getFieldConfigs(INNOVATION_TYPE_KEY);
      const values = applySubmissionAutoFields(inputValues, fields, formType, request.user);
      const owner = await getOwnerForSystem(INNOVATION_SYSTEM_NAME, client);
      const recordNo = await generateRecordNo(client, INNOVATION_TYPE_KEY, formType.name);
      const mergedValues: Record<string, unknown> = {
        ...values,
        record_no: recordNo,
        status: INNOVATION_DEFAULT_STATUS,
        studio_scope: INNOVATION_SYSTEM_NAME,
        system_owner: owner.ownerName
      };
      const result = await client.query<any>(
        `INSERT INTO records (record_no, type_key, title, system_name, status, priority, submitter_user_id,
                              submitter_name, owner_name, owner_feishu_user_id, values)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          recordNo,
          INNOVATION_TYPE_KEY,
          String(mergedValues.project_theme ?? ""),
          INNOVATION_SYSTEM_NAME,
          INNOVATION_DEFAULT_STATUS,
          request.user.id,
          request.user.name,
          owner.ownerName,
          owner.ownerFeishuUserId,
          JSON.stringify(mergedValues)
        ]
      );
      const record = result.rows[0];
      await client.query(
        `INSERT INTO timeline_events (record_id, event_type, title, body, actor_user_id, actor_name)
         VALUES ($1, 'record_created', '创新项目已提交', $2, $3, $4)`,
        [
          record.id,
          submissionTimelineBody({
            submitterName: request.user.name,
            submittedAt: record.created_at,
            ownerName: owner.ownerName,
            extra: `类型：${body.innovationKind}`
          }),
          request.user.id,
          request.user.name
        ]
      );
      await client.query(
        `INSERT INTO audit_logs (record_id, entity_type, entity_id, action, new_value, actor_user_id, actor_name)
         VALUES ($1, 'innovation_project', $2, 'create', $3, $4, $5)`,
        [record.id, record.id, JSON.stringify(mergedValues), request.user.id, request.user.name]
      );
      return record;
    });

    await trySendNotification(created.id, {
      eventKey: "record_created",
      title: `新创新项目：${created.title}`,
      body: `状态：${created.status}\n负责人：${created.owner_name ?? "未分派"}`,
      submitterFeishuUserId: request.user.feishuUserId,
      ownerFeishuUserId: created.owner_feishu_user_id,
      extraFeishuUserIds: innovationNotifyUserIds(created.values ?? {})
    });
    await tryCreateFeishuRecord(created);
    return toInnovationProject(created, { includeTimeline: true });
  });

  app.patch("/api/innovation/projects/:id/supplement", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = innovationSupplementInputSchema.parse(request.body);
    const allowStatus = canManageInnovation(request.user.role);
    if (body.status && !allowStatus) return app.httpErrors.forbidden("Only IT administrators can update innovation status.");

    const updated = await withTransaction(async (client) => {
      const currentResult = await client.query<any>("SELECT * FROM records WHERE id=$1 AND type_key=$2 FOR UPDATE", [params.id, INNOVATION_TYPE_KEY]);
      const current = currentResult.rows[0];
      if (!current) throw app.httpErrors.notFound("Innovation project not found.");
      if (!canSupplementInnovation(request.user, current)) throw app.httpErrors.forbidden("No access to supplement this innovation project.");

      const currentValues = current.values ?? {};
      const incoming = mapInnovationSupplementToValues(body, allowStatus);
      const businessIncoming = allowStatus ? incoming : Object.fromEntries(Object.entries(incoming).filter(([key]) => innovationSupplementKeys.includes(key as any)));
      const nextValues = { ...currentValues, ...businessIncoming };
      const nextStatus = allowStatus && body.status ? body.status : current.status;
      nextValues.status = nextStatus;
      const result = await client.query<any>(
        `UPDATE records
            SET status=$2,
                values=$3,
                updated_at=now()
          WHERE id=$1
          RETURNING *`,
        [params.id, nextStatus, JSON.stringify(nextValues)]
      );

      for (const [fieldKey, newValue] of Object.entries(businessIncoming)) {
        await client.query(
          `INSERT INTO audit_logs (record_id, entity_type, entity_id, action, field_key, old_value, new_value, actor_user_id, actor_name)
           VALUES ($1, 'innovation_project', $2, 'update', $3, $4, $5, $6, $7)`,
          [
            params.id,
            params.id,
            fieldKey,
            JSON.stringify(currentValues[fieldKey] ?? null),
            JSON.stringify(newValue ?? null),
            request.user.id,
            request.user.name
          ]
        );
      }

      if (nextStatus !== current.status) {
        await client.query(
          `INSERT INTO timeline_events (record_id, event_type, title, body, actor_user_id, actor_name)
           VALUES ($1, 'status_changed', '创新项目状态已更新', $2, $3, $4)`,
          [params.id, `${request.user.name} 在 ${dateTimeInChina()} 将状态从「${current.status}」修改为「${nextStatus}」`, request.user.id, request.user.name]
        );
      } else if (Object.keys(businessIncoming).length) {
        await client.query(
          `INSERT INTO timeline_events (record_id, event_type, title, body, actor_user_id, actor_name)
           VALUES ($1, 'innovation_supplemented', '创新项目信息已补充', $2, $3, $4)`,
          [params.id, `${request.user.name} 在 ${dateTimeInChina()} 补充了协同信息`, request.user.id, request.user.name]
        );
      }
      return result.rows[0];
    });

    await tryUpdateFeishuRecord(updated);
    await trySendNotification(updated.id, {
      eventKey: updated.status !== INNOVATION_DEFAULT_STATUS ? "status_changed" : "need_more_info",
      title: updated.status !== INNOVATION_DEFAULT_STATUS ? `创新项目状态更新：${updated.title}` : `创新项目信息更新：${updated.title}`,
      body: `状态：${updated.status}\n负责人：${updated.owner_name ?? "未分派"}`,
      submitterFeishuUserId: updated.values?.submitter_feishu_user_id ?? null,
      ownerFeishuUserId: updated.owner_feishu_user_id,
      extraFeishuUserIds: innovationNotifyUserIds(updated.values ?? {})
    });
    return toInnovationProject(updated, { includeTimeline: true });
  });

  app.delete("/api/admin/innovation/projects/:id", async (request) => {
    adminOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const currentResult = await query<any>("SELECT * FROM records WHERE id=$1 AND type_key=$2", [params.id, INNOVATION_TYPE_KEY]);
    const current = currentResult.rows[0];
    if (!current) return app.httpErrors.notFound("Innovation project not found.");
    try {
      if (current.feishu_record_id) await deleteFeishuRecord(current.type_key, current.feishu_record_id);
    } catch (error) {
      await query(
        `INSERT INTO audit_logs (record_id, entity_type, entity_id, action, old_value, actor_user_id, actor_name)
         VALUES ($1, 'innovation_project', $2, 'feishu_delete_warning', $3, $4, $5)`,
        [params.id, params.id, JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), request.user.id, request.user.name]
      );
    }
    const deleted = await withTransaction(async (client) => {
      await client.query("DELETE FROM innovation_awards WHERE record_id=$1", [params.id]);
      const result = await client.query<any>("DELETE FROM records WHERE id=$1 AND type_key=$2 RETURNING *", [params.id, INNOVATION_TYPE_KEY]);
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, actor_user_id, actor_name)
         VALUES ('innovation_project', $1, 'delete', $2, $3, $4)`,
        [params.id, JSON.stringify(current), request.user.id, request.user.name]
      );
      return result.rows[0];
    });
    return { ok: true, id: deleted.id, recordNo: deleted.record_no ?? null };
  });

  app.get("/api/innovation/awards", async () => {
    const result = await query<any>(
      `SELECT awards.*, records.title, records.record_no, records.status, records.submitter_name, records.values, records.created_at AS record_created_at, records.updated_at AS record_updated_at
         FROM innovation_awards awards
         JOIN records ON records.id = awards.record_id
        WHERE records.type_key=$1
        ORDER BY awards.display_order, awards.awarded_at DESC`,
      [INNOVATION_TYPE_KEY]
    );
    return result.rows.map((row) => ({
      ...toInnovationAward(row),
      projectTitle: row.title,
      recordNo: row.record_no,
      projectStatus: row.status,
      submitterName: row.submitter_name,
      projectValues: row.values ?? {}
    }));
  });

  app.post("/api/admin/innovation/awards", async (request) => {
    systemWorkerOnly(request.user.role);
    const parsed = innovationAwardInputSchema.safeParse(request.body);
    if (!parsed.success) return app.httpErrors.badRequest("请选择至少一个奖项。");
    const body = parsed.data;
    const record = await query<any>("SELECT * FROM records WHERE id=$1 AND type_key=$2", [body.recordId, INNOVATION_TYPE_KEY]);
    if (!record.rows[0]) return app.httpErrors.notFound("Innovation project not found.");
    const existing = await query<any>("SELECT award_name FROM innovation_awards WHERE record_id=$1", [body.recordId]);
    const existingAwardNames = new Set(
      existing.rows
        .flatMap((row) => String(row.award_name ?? "").split("、"))
        .map((name) => name.trim())
        .filter(Boolean)
    );
    const duplicated = body.awardNames.filter((name) => existingAwardNames.has(name));
    if (duplicated.length) {
      return app.httpErrors.badRequest(`${record.rows[0].title} 项目已是 ${duplicated.join("、")}，无需重复评奖。`);
    }
    const awardName = body.awardNames.join("、");
    const result = await query<any>(
      `INSERT INTO innovation_awards (record_id, award_name, award_type, reason, display_order, awarded_by_user_id, awarded_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [body.recordId, awardName, null, body.reason ?? null, body.displayOrder ?? 0, request.user.id, request.user.name]
    );
    await query(
      `INSERT INTO timeline_events (record_id, event_type, title, body, actor_user_id, actor_name)
       VALUES ($1, 'innovation_awarded', '创新项目已评奖', $2, $3, $4)`,
      [body.recordId, `${request.user.name} 授予「${awardName}」${body.reason ? `：${body.reason}` : ""}`, request.user.id, request.user.name]
    );
    await query(
      `INSERT INTO audit_logs (record_id, entity_type, entity_id, action, new_value, actor_user_id, actor_name)
       VALUES ($1, 'innovation_award', $2, 'create', $3, $4, $5)`,
      [body.recordId, result.rows[0].id, JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    await trySendNotification(body.recordId, {
      eventKey: "status_changed",
      title: `创新项目获奖：${record.rows[0].title}`,
      body: `奖项：${awardName}${body.reason ? `\n理由：${body.reason}` : ""}`,
      submitterFeishuUserId: record.rows[0].values?.submitter_feishu_user_id ?? null,
      ownerFeishuUserId: record.rows[0].owner_feishu_user_id,
      extraFeishuUserIds: innovationNotifyUserIds(record.rows[0].values ?? {})
    });
    return toInnovationAward(result.rows[0]);
  });

  app.get("/api/innovation/articles", async (request) => {
    const queryParams = z.object({ includeDrafts: z.coerce.boolean().optional() }).parse(request.query);
    const includeDrafts = queryParams.includeDrafts && canManageInnovation(request.user.role);
    const result = await query<any>(
      `SELECT *
         FROM innovation_articles
        ${includeDrafts ? "" : "WHERE status='published'"}
        ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC
        LIMIT 100`
    );
    return result.rows.map(toInnovationArticle);
  });

  app.get("/api/innovation/articles/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await query<any>("SELECT * FROM innovation_articles WHERE id=$1", [params.id]);
    const article = result.rows[0];
    if (!article) return app.httpErrors.notFound("Article not found.");
    if (article.status !== "published" && !canManageInnovation(request.user.role)) {
      return app.httpErrors.notFound("Article not found.");
    }
    return toInnovationArticle(article);
  });

  app.post("/api/admin/innovation/articles/word", async (request) => {
    systemWorkerOnly(request.user.role);
    const file = await request.file();
    if (!file) return app.httpErrors.badRequest("请上传 Word 文档。");
    const extension = path.extname(file.filename || "").toLowerCase();
    if (![".docx"].includes(extension)) {
      return app.httpErrors.badRequest("当前预览支持 .docx Word 文档，请上传 docx 文件。");
    }
    await fsp.mkdir(config.uploadDir, { recursive: true });
    const safeOriginalName = path.basename(file.filename || "innovation-note.docx").replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
    const storedName = `${Date.now()}-${randomUUID()}${extension}`;
    const filePath = path.join(config.uploadDir, storedName);
    const buffer = await file.toBuffer();
    if ((file as any).truncated) return app.httpErrors.badRequest("上传文件过大或传输不完整，请重新上传。");
    if (!buffer.length) return app.httpErrors.badRequest("上传文件为空，请重新选择 Word 文档。");
    let previewText = "";
    try {
      previewText = extractDocxPreview(buffer);
    } catch (error) {
      return app.httpErrors.badRequest(error instanceof Error ? error.message : "Word 文档解析失败，请重新上传 .docx 文件。");
    }
    const docxImages = extractDocxImages(buffer);
    await fsp.writeFile(filePath, buffer);
    for (const image of docxImages) {
      await fsp.writeFile(path.join(config.uploadDir, image.storedName), image.buffer);
    }
    let feishu: { fileToken?: string; error?: string } = {};
    try {
      const uploaded = await feishuService.uploadBitableAttachment({
        buffer,
        fileName: safeOriginalName,
        mimeType: file.mimetype || "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      });
      feishu = { fileToken: uploaded.fileToken };
    } catch (error) {
      feishu = { error: error instanceof Error ? error.message : "飞书附件上传失败" };
    }
    const title = safeOriginalName.replace(/\.docx$/i, "");
    const attachment = {
      name: safeOriginalName,
      storedName,
      mimeType: file.mimetype || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: buffer.length,
      url: `/api/uploads/${storedName}`,
      fileToken: feishu.fileToken,
      feishuError: feishu.error
    };
    const imageAttachments = docxImages.map(({ buffer: _buffer, ...image }) => image);
    const result = await query<any>(
      `INSERT INTO innovation_articles (title, summary, body, cover_image_url, attachments, status, author_user_id, author_name, published_at)
       VALUES ($1,$2,$3,$4,$5,'published',$6,$7,now())
       RETURNING *`,
      [
        title,
        previewText.split(/\n/).find(Boolean)?.slice(0, 120) ?? "Word 文档学习心得",
        previewText || "该 Word 文档暂未提取到可预览正文，请下载原文档查看。",
        imageAttachments[0]?.url ?? null,
        JSON.stringify([attachment, ...imageAttachments]),
        request.user.id,
        request.user.name
      ]
    );
    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, actor_user_id, actor_name)
       VALUES ('innovation_article', $1, 'upload_word', $2, $3, $4)`,
      [result.rows[0].id, JSON.stringify({ article: result.rows[0], attachment, imageCount: imageAttachments.length }), request.user.id, request.user.name]
    );
    return toInnovationArticle(result.rows[0]);
  });

  app.post("/api/admin/innovation/articles", async (request) => {
    systemWorkerOnly(request.user.role);
    const body = innovationArticleInputSchema.parse(request.body);
    const publishedAt = body.status === "published" ? new Date() : null;
    const result = await query<any>(
      `INSERT INTO innovation_articles (title, summary, body, cover_image_url, attachments, status, author_user_id, author_name, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        body.title,
        body.summary ?? "",
        body.body ?? "",
        body.coverImageUrl ?? null,
        JSON.stringify(body.attachments ?? []),
        body.status,
        request.user.id,
        request.user.name,
        publishedAt
      ]
    );
    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, actor_user_id, actor_name)
       VALUES ('innovation_article', $1, 'create', $2, $3, $4)`,
      [result.rows[0].id, JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    return toInnovationArticle(result.rows[0]);
  });

  app.patch("/api/admin/innovation/articles/:id", async (request) => {
    systemWorkerOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = innovationArticleInputSchema.partial().parse(request.body);
    const current = await query<any>("SELECT * FROM innovation_articles WHERE id=$1", [params.id]);
    if (!current.rows[0]) return app.httpErrors.notFound("Article not found.");
    const next = { ...current.rows[0] };
    if (body.title !== undefined) next.title = body.title;
    if (body.summary !== undefined) next.summary = body.summary;
    if (body.body !== undefined) next.body = body.body;
    if (body.coverImageUrl !== undefined) next.cover_image_url = body.coverImageUrl;
    if (body.attachments !== undefined) next.attachments = body.attachments;
    if (body.status !== undefined) {
      next.status = body.status;
      if (body.status === "published" && !next.published_at) next.published_at = new Date();
      if (body.status !== "published") next.published_at = null;
    }
    const result = await query<any>(
      `UPDATE innovation_articles
          SET title=$2,
              summary=$3,
              body=$4,
              cover_image_url=$5,
              attachments=$6,
              status=$7,
              published_at=$8,
              updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [
        params.id,
        next.title,
        next.summary,
        next.body,
        next.cover_image_url,
        JSON.stringify(next.attachments ?? []),
        next.status,
        next.published_at
      ]
    );
    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, actor_user_id, actor_name)
       VALUES ('innovation_article', $1, 'update', $2, $3, $4, $5)`,
      [params.id, JSON.stringify(current.rows[0]), JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    return toInnovationArticle(result.rows[0]);
  });

  app.delete("/api/admin/innovation/articles/:id", async (request) => {
    adminOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const deleted = await query<any>(
      `DELETE FROM innovation_articles
        WHERE id=$1
        RETURNING *`,
      [params.id]
    );
    if (!deleted.rows[0]) return app.httpErrors.notFound("Article not found.");
    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, actor_user_id, actor_name)
       VALUES ('innovation_article', $1, 'delete', $2, $3, $4)`,
      [params.id, JSON.stringify(deleted.rows[0]), request.user.id, request.user.name]
    );
    return { ok: true, id: params.id };
  });

  app.get("/api/admin/admin-members", async (request) => {
    adminOnly(request.user.role);
    const result = await query<any>(
      `SELECT id, name, feishu_user_id, employee_no, role, note, enabled
         FROM admin_members
        ORDER BY enabled DESC, role DESC, name`
    );
    return result.rows.map(toAdminMember);
  });

  app.get("/api/admin/feishu/users/search", async (request) => {
    adminOnly(request.user.role);
    const queryParams = z.object({
      query: z.string().trim().min(1),
      pageSize: z.coerce.number().int().min(1).max(20).default(10),
      pageToken: z.string().optional()
    }).parse(request.query);
    return searchFeishuUsersForRequest(request, queryParams);
  });

  app.get("/api/admin/config/export", async (request, reply) => {
    adminOnly(request.user.role);
    const [formTypes, fieldConfigs, systemOwners, adminMembers, notificationRules] = await Promise.all([
      query<any>("SELECT * FROM form_types ORDER BY sort_order, name"),
      query<any>("SELECT * FROM field_configs ORDER BY form_type_key, sort_order, label"),
      query<any>("SELECT * FROM system_owners ORDER BY system_name"),
      query<any>("SELECT * FROM admin_members ORDER BY enabled DESC, name"),
      query<any>("SELECT * FROM notification_rules ORDER BY event_key")
    ]);
    const exportedAt = new Date().toISOString();
    const payload = {
      version: 1,
      exportedAt,
      formTypes: formTypes.rows,
      fieldConfigs: fieldConfigs.rows,
      systemOwners: systemOwners.rows,
      adminMembers: adminMembers.rows,
      notificationRules: notificationRules.rows
    };
    reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="it-jiebangtai-config-${exportedAt.slice(0, 10)}.json"`);
    return payload;
  });

  app.post("/api/admin/config/import", async (request) => {
    adminOnly(request.user.role);
    const body = z.object({
      backup: z.object({
        formTypes: z.array(z.record(z.unknown())).default([]),
        fieldConfigs: z.array(z.record(z.unknown())).default([]),
        systemOwners: z.array(z.record(z.unknown())).default([]),
        adminMembers: z.array(z.record(z.unknown())).default([]),
        notificationRules: z.array(z.record(z.unknown())).default([])
      }).passthrough()
    }).parse(request.body);
    const summary = { formTypes: 0, fieldConfigs: 0, systemOwners: 0, adminMembers: 0, notificationRules: 0 };

    await withTransaction(async (client) => {
      for (const row of body.backup.formTypes) {
        const key = String(row.key ?? "").trim();
        if (!key) continue;
        await client.query(
          `INSERT INTO form_types (key, name, description, title_field_key, system_field_key, submitter_field_key, status_field_key, sort_order, enabled, feishu_table_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (key) DO UPDATE SET
             name=EXCLUDED.name,
             description=EXCLUDED.description,
             title_field_key=EXCLUDED.title_field_key,
             system_field_key=EXCLUDED.system_field_key,
             submitter_field_key=EXCLUDED.submitter_field_key,
             status_field_key=EXCLUDED.status_field_key,
             sort_order=EXCLUDED.sort_order,
             enabled=EXCLUDED.enabled,
             feishu_table_id=EXCLUDED.feishu_table_id,
             updated_at=now()`,
          [
            key,
            String(row.name ?? key),
            row.description ?? null,
            String(row.title_field_key ?? "title"),
            String(row.system_field_key ?? "system"),
            String(row.submitter_field_key ?? "submitter"),
            String(row.status_field_key ?? "status"),
            Number(row.sort_order ?? 100),
            row.enabled !== false,
            row.feishu_table_id ? String(row.feishu_table_id) : null
          ]
        );
        summary.formTypes += 1;
      }

      for (const row of body.backup.fieldConfigs) {
        const formTypeKey = String(row.form_type_key ?? "").trim();
        const fieldKey = String(row.field_key ?? "").trim();
        if (!formTypeKey || !fieldKey) continue;
        await client.query(
          `INSERT INTO field_configs (form_type_key, field_key, label, kind, required, visible_to_business, editable_by_business, business_visible, internal, show_in_list, sort_order, options, feishu_field_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (form_type_key, field_key) DO UPDATE SET
             label=EXCLUDED.label,
             kind=EXCLUDED.kind,
             required=EXCLUDED.required,
             visible_to_business=EXCLUDED.visible_to_business,
             editable_by_business=EXCLUDED.editable_by_business,
             business_visible=EXCLUDED.business_visible,
             internal=EXCLUDED.internal,
             show_in_list=EXCLUDED.show_in_list,
             sort_order=EXCLUDED.sort_order,
             options=EXCLUDED.options,
             feishu_field_name=EXCLUDED.feishu_field_name,
             updated_at=now()`,
          [
            formTypeKey,
            fieldKey,
            String(row.label ?? fieldKey),
            String(row.kind ?? "text"),
            row.required === true,
            row.visible_to_business !== false,
            row.editable_by_business !== false,
            row.business_visible !== false,
            row.internal === true,
            row.show_in_list === true,
            Number(row.sort_order ?? 100),
            JSON.stringify(row.options ?? []),
            row.feishu_field_name ? String(row.feishu_field_name) : String(row.label ?? fieldKey)
          ]
        );
        summary.fieldConfigs += 1;
      }

      for (const row of body.backup.systemOwners) {
        const systemName = String(row.system_name ?? "").trim();
        if (!systemName) continue;
        await client.query(
          `INSERT INTO system_owners (system_name, owner_name, owner_feishu_user_id, consultant_names, enabled)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (system_name) DO UPDATE SET
             owner_name=EXCLUDED.owner_name,
             owner_feishu_user_id=EXCLUDED.owner_feishu_user_id,
             consultant_names=EXCLUDED.consultant_names,
             enabled=EXCLUDED.enabled,
             updated_at=now()`,
          [
            systemName,
            String(row.owner_name ?? ""),
            row.owner_feishu_user_id ? String(row.owner_feishu_user_id) : null,
            row.consultant_names ? String(row.consultant_names) : null,
            row.enabled !== false
          ]
        );
        summary.systemOwners += 1;
      }

      for (const row of body.backup.adminMembers) {
        const name = String(row.name ?? "").trim();
        const feishuUserId = row.feishu_user_id ? String(row.feishu_user_id) : null;
        const employeeNo = row.employee_no ? String(row.employee_no) : feishuUserId;
        const memberRole = row.role === "admin" || isSuperAdminIdentityValue(feishuUserId, employeeNo, name) ? "admin" : "system_owner";
        if (!name) continue;
        const existing = feishuUserId
          ? await client.query<any>("SELECT id FROM admin_members WHERE lower(feishu_user_id)=lower($1) LIMIT 1", [feishuUserId])
          : await client.query<any>("SELECT id FROM admin_members WHERE name=$1 AND feishu_user_id IS NULL LIMIT 1", [name]);
        if (existing.rows[0]) {
          await client.query(
            `UPDATE admin_members
                SET name=$2,
                    feishu_user_id=$3,
                    employee_no=$4,
                    role=$5,
                    note=$6,
                    enabled=$7,
                    updated_at=now()
              WHERE id=$1`,
            [
              existing.rows[0].id,
              name,
              feishuUserId,
              employeeNo,
              memberRole,
              row.note ? String(row.note) : null,
              row.enabled !== false
            ]
          );
        } else {
          await client.query(
            `INSERT INTO admin_members (name, feishu_user_id, employee_no, role, note, enabled)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              name,
              feishuUserId,
              employeeNo,
              memberRole,
              row.note ? String(row.note) : null,
              row.enabled !== false
            ]
          );
        }
        summary.adminMembers += 1;
      }

      for (const row of body.backup.notificationRules) {
        const eventKey = String(row.event_key ?? "").trim();
        if (!eventKey) continue;
        await client.query(
          `INSERT INTO notification_rules (event_key, name, template, enabled)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (event_key) DO UPDATE SET
             name=EXCLUDED.name,
             template=EXCLUDED.template,
             enabled=EXCLUDED.enabled,
             updated_at=now()`,
          [
            eventKey,
            String(row.name ?? eventKey),
            String(row.template ?? ""),
            row.enabled !== false
          ]
        );
        summary.notificationRules += 1;
      }

      await client.query(
        `INSERT INTO audit_logs (entity_type, action, new_value, actor_user_id, actor_name)
         VALUES ('config_backup', 'import', $1, $2, $3)`,
        [JSON.stringify(summary), request.user.id, request.user.name]
      );
    });

    return summary;
  });

  app.post("/api/admin/admin-members", async (request) => {
    adminOnly(request.user.role);
    const body = z.object({
      name: z.string().min(1),
      feishuUserId: z.string().nullable().optional(),
      employeeNo: z.string().nullable().optional(),
      role: z.enum(["system_owner", "admin"]).default("system_owner"),
      note: z.string().nullable().optional(),
      enabled: z.boolean().default(true)
    }).parse(request.body);
    const feishuUserId = normalizeManualFeishuUserId(body.feishuUserId);
    const employeeNo = body.employeeNo?.trim() || feishuUserId || null;
    const memberRole = isSuperAdminIdentityValue(feishuUserId, employeeNo, body.name) ? "admin" : body.role;
    const existing = feishuUserId
      ? await query<any>("SELECT id FROM admin_members WHERE lower(feishu_user_id)=lower($1) LIMIT 1", [feishuUserId])
      : { rows: [] };
    const result = existing.rows[0]
      ? await query<any>(
        `UPDATE admin_members
            SET name=$2,
                employee_no=$3,
                role=$4,
                note=$5,
                enabled=$6,
                updated_at=now()
          WHERE id=$1
          RETURNING *`,
        [existing.rows[0].id, body.name, employeeNo, memberRole, body.note ?? null, body.enabled]
      )
      : await query<any>(
        `INSERT INTO admin_members (name, feishu_user_id, employee_no, role, note, enabled)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [body.name, feishuUserId, employeeNo, memberRole, body.note ?? null, body.enabled]
      );
    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, actor_user_id, actor_name)
       VALUES ('admin_member', $1, 'upsert', $2, $3, $4)`,
      [result.rows[0].id, JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    return toAdminMember(result.rows[0]);
  });

  app.patch("/api/admin/admin-members/:id", async (request) => {
    adminOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      name: z.string().min(1).optional(),
      feishuUserId: z.string().nullable().optional(),
      employeeNo: z.string().nullable().optional(),
      role: z.enum(["system_owner", "admin"]).optional(),
      note: z.string().nullable().optional(),
      enabled: z.boolean().optional()
    }).parse(request.body);
    const current = await query<any>("SELECT * FROM admin_members WHERE id=$1", [params.id]);
    if (!current.rows[0]) return app.httpErrors.notFound("Admin member not found.");
    const next = { ...current.rows[0] };
    if (body.name !== undefined) next.name = body.name;
    if (body.feishuUserId !== undefined) next.feishu_user_id = normalizeManualFeishuUserId(body.feishuUserId);
    if (body.employeeNo !== undefined) next.employee_no = body.employeeNo?.trim() || next.feishu_user_id || null;
    if (body.role !== undefined) next.role = body.role;
    if (isSuperAdminIdentityValue(next.feishu_user_id, next.employee_no, next.name)) next.role = "admin";
    if (body.note !== undefined) next.note = body.note;
    if (body.enabled !== undefined) next.enabled = body.enabled;
    const result = await query<any>(
      `UPDATE admin_members
          SET name=$2,
              feishu_user_id=$3,
              employee_no=$4,
              role=$5,
              note=$6,
              enabled=$7,
              updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [params.id, next.name, next.feishu_user_id, next.employee_no, next.role, next.note, next.enabled]
    );
    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, actor_user_id, actor_name)
       VALUES ('admin_member', $1, 'update', $2, $3, $4, $5)`,
      [params.id, JSON.stringify(current.rows[0]), JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    return toAdminMember(result.rows[0]);
  });

  app.post("/api/admin/form-types", async (request) => {
    adminOnly(request.user.role);
    const body = z.object({
      key: z.string().min(2).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
      name: z.string().min(1),
      description: z.string().optional(),
      createBitableTable: z.boolean().default(true)
    }).parse(request.body);

    let feishuTableId: string | null = null;
    if (body.createBitableTable && config.feishu.bitableAppToken) {
      const table = await feishuService.createBitableTable(body.name);
      feishuTableId = table.table_id ?? table.table?.table_id ?? null;
    }

    const result = await query<any>(
      `INSERT INTO form_types (key, name, description, title_field_key, system_field_key, submitter_field_key, status_field_key, feishu_table_id, sort_order)
       VALUES ($1,$2,$3,'title','system','submitter','status',$4,(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM form_types))
       RETURNING *`,
      [body.key, body.name, body.description ?? null, feishuTableId]
    );

    const defaultFields = [
      { fieldKey: "title", label: `${body.name}名称`, kind: "text", required: true, sortOrder: 1 },
      { fieldKey: "description", label: `${body.name}描述`, kind: "textarea", required: true, sortOrder: 2 },
      { fieldKey: "attachments", label: `${body.name}附件`, kind: "attachment", required: false, sortOrder: 3 },
      { fieldKey: "system", label: "对应系统", kind: "select", required: true, sortOrder: 4 },
      { fieldKey: "status", label: "当前状态", kind: "select", required: false, sortOrder: 5, options: ["待处理", "处理中", "设计已完成", "开发已完成", "测试已完成", "部署已完成", "状态异常", "已延期", "已关闭"] },
      { fieldKey: "submitter", label: "提交人", kind: "person", required: false, sortOrder: 6, visibleToBusiness: false, editableByBusiness: false },
      { fieldKey: "submitted_at", label: "提出时间", kind: "date", required: false, sortOrder: 7, visibleToBusiness: false, editableByBusiness: false }
    ];

    for (const field of defaultFields) {
      if (feishuTableId) {
        try {
          await feishuService.createBitableField(feishuTableId, {
            fieldName: field.label,
            type: bitableFieldType(field.kind),
            property: bitableFieldProperty(field.kind, (field as any).options ?? [])
          });
        } catch {
          // The default primary text field can already exist in a new table.
        }
      }
      await query(
        `INSERT INTO field_configs (form_type_key, field_key, label, kind, required, visible_to_business, editable_by_business, business_visible, show_in_list, sort_order, options, feishu_field_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$3)`,
        [
          body.key,
          field.fieldKey,
          field.label,
          field.kind,
          field.required,
          (field as any).visibleToBusiness ?? true,
          (field as any).editableByBusiness ?? true,
          ["title", "system", "status"].includes(field.fieldKey),
          field.sortOrder,
          JSON.stringify((field as any).options ?? [])
        ]
      );
    }

    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, actor_user_id, actor_name)
       VALUES ('form_type', $1, 'create', $2, $3, $4)`,
      [result.rows[0].id, JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    return result.rows[0];
  });

  app.post("/api/admin/feishu/sync-from-bitable", async (request) => {
    adminOnly(request.user.role);
    const tables = await feishuService.listBitableTables();
    const remoteTables = tables.items ?? [];
    const remoteTableIds = new Set(remoteTables.map((table) => table.table_id));
    const summary = {
      disabledFormTypes: [] as string[],
      importedFormTypes: [] as string[],
      syncedFields: 0,
      createdFields: 0,
      removedFields: 0,
      removedRecords: 0
    };

    await withTransaction(async (client) => {
      const localTypes = await client.query<any>("SELECT * FROM form_types ORDER BY sort_order, name");
      for (const type of localTypes.rows) {
        const builtinType = ["demand", "issue"].includes(type.key);
        const missingRemoteTable = type.feishu_table_id && !remoteTableIds.has(type.feishu_table_id);
        const localOnlyCustomType = !builtinType && !type.feishu_table_id;
        if ((missingRemoteTable || localOnlyCustomType) && type.enabled) {
          await client.query("UPDATE form_types SET enabled=false, updated_at=now() WHERE id=$1", [type.id]);
          summary.disabledFormTypes.push(type.name);
        }
      }
      await client.query(
        `DELETE FROM field_configs
          WHERE form_type_key IN (
            SELECT key FROM form_types WHERE enabled = false
          )`
      );

      const existingByTable = new Map<string, any>(localTypes.rows.filter((type: any) => type.feishu_table_id).map((type: any) => [type.feishu_table_id, type]));
      for (const table of remoteTables) {
        if (isManagedNonRecordTable(table.table_id)) continue;
        let localType: any = existingByTable.get(table.table_id);
        const builtinKey = builtinTypeForTableId(table.table_id);
        if (!localType && builtinKey) {
          const updatedBuiltin = await client.query<any>(
            "UPDATE form_types SET feishu_table_id=$2, enabled=true, updated_at=now() WHERE key=$1 RETURNING *",
            [builtinKey, table.table_id]
          );
          localType = updatedBuiltin.rows[0];
        }
        if (!localType) {
          const key = formTypeKeyFromTable(table.table_id);
          const name = cleanFormTypeName(table.name);
          const inserted = await client.query<any>(
            `INSERT INTO form_types (key, name, description, title_field_key, system_field_key, submitter_field_key, status_field_key, feishu_table_id, sort_order)
             VALUES ($1,$2,'从飞书多维表格同步导入。','title','system','submitter','status',$3,(SELECT COALESCE(MAX(sort_order),0)+1 FROM form_types))
             ON CONFLICT (key) DO UPDATE SET enabled=true, feishu_table_id=EXCLUDED.feishu_table_id, updated_at=now()
             RETURNING *`,
            [key, name, table.table_id]
          );
          localType = inserted.rows[0];
          summary.importedFormTypes.push(name);
        } else if (!localType.enabled) {
          const enabled = await client.query<any>("UPDATE form_types SET enabled=true, updated_at=now() WHERE id=$1 RETURNING *", [localType.id]);
          localType = enabled.rows[0];
        }

        const fields = await feishuService.listBitableFields(table.table_id);
        const remoteFields = (fields.items ?? []).filter((field: any) => field.field_name && field.field_id);
        const remoteNames = new Set(remoteFields.map((field: any) => String(field.field_name)));
        const localFields = await client.query<any>("SELECT * FROM field_configs WHERE form_type_key=$1", [localType.key]);

        for (const localField of localFields.rows) {
          if (localField.feishu_field_name && !remoteNames.has(localField.feishu_field_name)) {
            await client.query("DELETE FROM field_configs WHERE id=$1", [localField.id]);
            summary.removedFields += 1;
          }
        }

        const refreshedLocalFields = await client.query<any>("SELECT * FROM field_configs WHERE form_type_key=$1", [localType.key]);
        const byFeishuName = new Map<string, any>(refreshedLocalFields.rows.map((field: any) => [field.feishu_field_name, field]));
        let sortOrder = refreshedLocalFields.rows.reduce((max: number, field: any) => Math.max(max, Number(field.sort_order ?? 0)), 0);

        for (const remoteField of remoteFields as Array<Record<string, unknown>>) {
          const label = String(remoteField.field_name);
          const kind = kindFromBitableFieldType(remoteField.type);
          const options = optionsFromBitableField(remoteField);
          const existing = byFeishuName.get(label);
          if (existing) {
            await client.query(
              `UPDATE field_configs
                  SET label=$2,
                      kind=$3,
                      options=$4,
                      updated_at=now()
                WHERE id=$1`,
              [existing.id, label, kind, JSON.stringify(options)]
            );
            summary.syncedFields += 1;
          } else {
            sortOrder += 1;
            const fieldKey = fieldKeyFromLabel(label);
            await client.query(
              `INSERT INTO field_configs (form_type_key, field_key, label, kind, required, visible_to_business, editable_by_business, business_visible, internal, show_in_list, sort_order, options, feishu_field_name)
               VALUES ($1,$2,$3,$4,false,true,true,true,false,false,$5,$6,$3)
               ON CONFLICT (form_type_key, field_key) DO UPDATE SET
                 label=EXCLUDED.label,
                 kind=EXCLUDED.kind,
                 options=EXCLUDED.options,
                 business_visible=EXCLUDED.business_visible,
                 feishu_field_name=EXCLUDED.feishu_field_name,
                 updated_at=now()`,
              [localType.key, fieldKey, label, kind, sortOrder, JSON.stringify(options)]
            );
            summary.createdFields += 1;
          }
        }

        const remoteRecordIds = await feishuService.listAllBitableRecordIds(table.table_id);
        const localSyncedRecords = await client.query<{ id: string; feishu_record_id: string }>(
          "SELECT id, feishu_record_id FROM records WHERE type_key=$1 AND feishu_record_id IS NOT NULL",
          [localType.key]
        );
        const deletedRecordIds = localSyncedRecords.rows
          .filter((record) => !remoteRecordIds.has(record.feishu_record_id))
          .map((record) => record.id);
        if (deletedRecordIds.length) {
          await client.query("DELETE FROM records WHERE id = ANY($1::uuid[])", [deletedRecordIds]);
          summary.removedRecords += deletedRecordIds.length;
        }
      }

      await client.query(
        `INSERT INTO audit_logs (entity_type, action, new_value, actor_user_id, actor_name)
         VALUES ('bitable_schema', 'sync_from_bitable', $1, $2, $3)`,
        [JSON.stringify(summary), request.user.id, request.user.name]
      );
    });

    return summary;
  });

  app.post("/api/admin/feishu/sync-records-from-bitable", async (request) => {
    adminOnly(request.user.role);
    const tables = await feishuService.listBitableTables();
    const remoteTables = tables.items ?? [];
    const summary = {
      syncedTypes: [] as string[],
      importedRecords: 0,
      updatedRecords: 0,
      removedLocalRecords: 0
    };

    await withTransaction(async (client) => {
      const formTypes = await client.query<any>("SELECT * FROM form_types WHERE enabled=true ORDER BY sort_order, name");
      const byTableId = new Map(formTypes.rows.filter((type: any) => type.feishu_table_id).map((type: any) => [type.feishu_table_id, type]));

      for (const table of remoteTables) {
        if (isManagedNonRecordTable(table.table_id)) continue;
        let formType: any = byTableId.get(table.table_id);
        const builtinKey = builtinTypeForTableId(table.table_id);
        if (!formType && builtinKey) {
          const result = await client.query<any>("SELECT * FROM form_types WHERE key=$1 AND enabled=true", [builtinKey]);
          formType = result.rows[0];
        }
        if (!formType) continue;

        const fieldsResult = await client.query<any>(
          "SELECT * FROM field_configs WHERE form_type_key=$1 ORDER BY sort_order, label",
          [formType.key]
        );
        const fields = fieldsResult.rows;
        const remoteRecords = await feishuService.listAllBitableRecords(table.table_id);
        const remoteRecordIds = new Set(remoteRecords.map((remoteRecord) => String((remoteRecord as any).record_id ?? "")).filter(Boolean));
        const deleted = await client.query(
          `DELETE FROM records
            WHERE type_key=$1
              AND feishu_record_id IS NOT NULL
              AND NOT (feishu_record_id = ANY($2::text[]))`,
          [formType.key, [...remoteRecordIds]]
        );
        summary.removedLocalRecords += deleted.rowCount ?? 0;

        for (const remoteRecord of remoteRecords) {
          const remoteFields = ((remoteRecord as any).fields ?? {}) as Record<string, unknown>;
          const recordId = String((remoteRecord as any).record_id ?? "");
          if (!recordId) continue;
          const values: Record<string, unknown> = {};
          for (const field of fields) {
            const remoteName = field.feishu_field_name || field.label;
            values[field.field_key] = bitableValueToAppValue(field.kind, remoteFields[remoteName]);
          }

          const title = bitableValueToString(values[formType.title_field_key]) || "未命名记录";
          const systemName = bitableValueToString(values[formType.system_field_key]) || "未填写系统";
          const status = bitableValueToString(values[formType.status_field_key]) || "待处理";
          const owner = await getOwnerForSystem(systemName, client);
          const recordNo = bitableValueToString(values.record_no) || bitableValueToString(remoteFields.record_no) || await generateRecordNo(client, formType.key, formType.name);
          const submitterName = bitableValueToString(values[formType.submitter_field_key]) || "飞书同步";
          values.record_no = recordNo;
          values[formType.title_field_key] = title;
          values[formType.system_field_key] = systemName;
          values[formType.status_field_key] = status;
          values.system_owner = owner.ownerName;

          const existing = await client.query<any>(
            "SELECT * FROM records WHERE type_key=$1 AND feishu_record_id=$2 LIMIT 1",
            [formType.key, recordId]
          );
          const existingRecord = existing.rows[0];
          if (existingRecord) {
            const mergedValues = {
              ...(existingRecord.values ?? {}),
              ...values
            };
            const result = await client.query(
              `UPDATE records
                  SET record_no=COALESCE(record_no, $2),
                      title=$3,
                      system_name=$4,
                      status=$5,
                      priority=$6,
                      submitter_name=COALESCE(NULLIF(submitter_name, '飞书同步'), $7),
                      owner_name=$8,
                      owner_feishu_user_id=COALESCE(owner_feishu_user_id, $9),
                      values=$10,
                      updated_at=now()
                WHERE id=$1`,
              [
                existingRecord.id,
                recordNo,
                title,
                systemName,
                status,
                bitableValueToString(values.priority ?? values.demand_priority ?? values.issue_priority) || null,
                submitterName,
                owner.ownerName,
                owner.ownerFeishuUserId,
                JSON.stringify(mergedValues)
              ]
            );
            summary.updatedRecords += result.rowCount ?? 0;
            continue;
          }

          const inserted = await client.query<any>(
            `INSERT INTO records (record_no, type_key, title, system_name, status, priority, submitter_user_id,
                                  submitter_name, owner_name, owner_feishu_user_id, values, feishu_record_id)
             VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9,$10,$11)
             RETURNING id, created_at`,
            [
              recordNo,
              formType.key,
              title,
              systemName,
              status,
              bitableValueToString(values.priority ?? values.demand_priority ?? values.issue_priority) || null,
              submitterName,
              owner.ownerName,
              owner.ownerFeishuUserId,
              JSON.stringify(values),
              recordId || null
            ]
          );
          await client.query(
            `INSERT INTO timeline_events (record_id, event_type, title, body, actor_name, created_at)
             VALUES ($1, 'record_created', '记录已提交', $2, $3, $4)`,
            [
              inserted.rows[0].id,
              submissionTimelineBody({
                submitterName,
                submittedAt: inserted.rows[0].created_at,
                ownerName: owner.ownerName,
                extra: "来源：飞书多维表格同步"
              }),
              submitterName,
              inserted.rows[0].created_at
            ]
          );
          summary.importedRecords += 1;
        }
        summary.syncedTypes.push(formType.name);
      }

      await client.query(
        `INSERT INTO audit_logs (entity_type, action, new_value, actor_user_id, actor_name)
         VALUES ('bitable_records', 'sync_from_bitable', $1, $2, $3)`,
        [JSON.stringify(summary), request.user.id, request.user.name]
      );
    });

    return summary;
  });

  app.patch("/api/admin/system-owners/:id", async (request) => {
    adminOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      ownerName: z.string().min(1).optional(),
      ownerFeishuUserId: z.string().optional(),
      consultantNames: z.string().nullable().optional(),
      enabled: z.boolean().optional()
    }).parse(request.body);
    const current = await query<any>("SELECT * FROM system_owners WHERE id = $1", [params.id]);
    if (!current.rows[0]) return app.httpErrors.notFound("System owner not found.");
    const next = { ...current.rows[0] };
    const ownerNameChanged = body.ownerName !== undefined && body.ownerName !== current.rows[0].owner_name;
    if (body.ownerName !== undefined) next.owner_name = body.ownerName;
    next.owner_feishu_user_id = body.ownerFeishuUserId !== undefined
      ? normalizeManualFeishuUserId(body.ownerFeishuUserId)
      : ownerNameChanged
        ? null
        : next.owner_feishu_user_id;
    if (body.consultantNames !== undefined) next.consultant_names = body.consultantNames;
    if (body.enabled !== undefined) next.enabled = body.enabled;
    const result = await query<any>(
      `UPDATE system_owners
          SET owner_name=$2,
              owner_feishu_user_id=$3,
              consultant_names=$4,
              enabled=$5,
              updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [params.id, next.owner_name, next.owner_feishu_user_id, next.consultant_names, next.enabled]
    );
    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, actor_user_id, actor_name)
       VALUES ('system_owner', $1, 'update', $2, $3, $4, $5)`,
      [params.id, JSON.stringify(current.rows[0]), JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    return result.rows[0];
  });

  app.post("/api/admin/system-owners", async (request) => {
    adminOnly(request.user.role);
    const body = z.object({
      systemName: z.string().min(1),
      ownerName: z.string().min(1),
      ownerFeishuUserId: z.string().nullable().optional(),
      consultantNames: z.string().nullable().optional(),
      enabled: z.boolean().default(true)
    }).parse(request.body);
    const ownerFeishuUserId = normalizeManualFeishuUserId(body.ownerFeishuUserId);
    const result = await query<any>(
      `INSERT INTO system_owners (system_name, owner_name, owner_feishu_user_id, consultant_names, enabled)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (system_name) DO UPDATE SET
         owner_name=EXCLUDED.owner_name,
         owner_feishu_user_id=EXCLUDED.owner_feishu_user_id,
         consultant_names=EXCLUDED.consultant_names,
         enabled=EXCLUDED.enabled,
         updated_at=now()
       RETURNING *`,
      [body.systemName, body.ownerName, ownerFeishuUserId, body.consultantNames ?? null, body.enabled]
    );
    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, actor_user_id, actor_name)
       VALUES ('system_owner', $1, 'upsert', $2, $3, $4)`,
      [result.rows[0].id, JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    return result.rows[0];
  });

  app.get("/api/records", async (request) => {
    const queryParams = z.object({
      typeKey: z.string().optional(),
      status: z.string().optional(),
      systemName: z.string().optional()
    }).parse(request.query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (queryParams.typeKey) {
      if (queryParams.typeKey === INNOVATION_TYPE_KEY) return [];
      params.push(queryParams.typeKey);
      conditions.push(`type_key = $${params.length}`);
    } else {
      params.push(INNOVATION_TYPE_KEY);
      conditions.push(`type_key <> $${params.length}`);
    }
    if (queryParams.status) {
      params.push(queryParams.status);
      conditions.push(`status = $${params.length}`);
    }
    if (queryParams.systemName) {
      params.push(queryParams.systemName);
      conditions.push(`system_name = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await query(
      `SELECT * FROM records ${where} ORDER BY updated_at DESC LIMIT 200`,
      params
    );
    return result.rows.map(summarizeRecord);
  });

  app.get("/api/records/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const recordResult = await query<any>("SELECT * FROM records WHERE id = $1", [params.id]);
    const record = recordResult.rows[0];
    if (!record) return app.httpErrors.notFound("Record not found.");
    if (isInnovationRecord(record)) return app.httpErrors.notFound("Innovation records are only available in Innovation Studio.");
    if (!canViewRecord(request.user, record)) return app.httpErrors.forbidden("No access to this record.");

    const [comments, timeline, auditLogs] = await Promise.all([
      query("SELECT id, author_name, body, created_at FROM comments WHERE record_id = $1 ORDER BY created_at", [params.id]),
      query("SELECT id, event_type, title, body, actor_name, created_at FROM timeline_events WHERE record_id = $1 ORDER BY created_at", [params.id]),
      query("SELECT id, field_key, old_value, new_value, actor_name, created_at FROM audit_logs WHERE record_id = $1 ORDER BY created_at DESC LIMIT 100", [params.id])
    ]);

    return {
      ...summarizeRecord(record),
      values: await visibleValuesForUser(request.user, record),
      comments: comments.rows.map((row: any) => ({
        id: row.id,
        authorName: row.author_name,
        body: row.body,
        createdAt: row.created_at
      })),
      timeline: timeline.rows.map((row: any) => ({
        id: row.id,
        eventType: row.event_type,
        title: row.title,
        body: row.body,
        actorName: row.actor_name,
        createdAt: row.created_at
      })),
      auditLogs: auditLogs.rows.map((row: any) => ({
        id: row.id,
        fieldKey: row.field_key,
        oldValue: row.old_value,
        newValue: row.new_value,
        actorName: row.actor_name,
        createdAt: row.created_at
      }))
    };
  });

  app.post("/api/records/:typeKey", async (request) => {
    const params = z.object({ typeKey: z.string() }).parse(request.params);
    if (params.typeKey === INNOVATION_TYPE_KEY) {
      return app.httpErrors.badRequest("创新工作室项目请从创新工作室页面提交。");
    }
    const body = createRecordSchema.parse({ ...(request.body as Record<string, unknown>), typeKey: params.typeKey });
    const created = await withTransaction(async (client) => {
      const formType = await getFormType(body.typeKey, client);
      if (!formType) throw app.httpErrors.notFound("Unknown form type.");

      const fields = await getFieldConfigs(body.typeKey);
      const values = applySubmissionAutoFields(body.values, fields, formType, request.user);
      const title = String(values[formType.titleFieldKey] ?? "");
      const systemName = String(values[formType.systemFieldKey] ?? "");
      const status = "待处理";
      if (!title || !systemName) throw app.httpErrors.badRequest("Title and system are required.");

      const owner = await getOwnerForSystem(systemName, client);
      const recordNo = await generateRecordNo(client, body.typeKey, formType.name);
      const mergedValues = {
        ...values,
        record_no: recordNo,
        [formType.systemFieldKey]: systemName,
        [formType.statusFieldKey]: status,
        system_owner: owner.ownerName
      };
      const result = await client.query(
        `INSERT INTO records (record_no, type_key, title, system_name, status, priority, submitter_user_id,
                              submitter_name, owner_name, owner_feishu_user_id, values)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          recordNo,
          body.typeKey,
          title,
          systemName,
          status,
          String(values.priority ?? values.demand_priority ?? values.issue_priority ?? "") || null,
          request.user.id,
          request.user.name,
          owner.ownerName,
          owner.ownerFeishuUserId,
          JSON.stringify(mergedValues)
        ]
      );
      const record = result.rows[0];
      await client.query(
        `INSERT INTO timeline_events (record_id, event_type, title, body, actor_user_id, actor_name)
         VALUES ($1, 'record_created', '记录已提交', $2, $3, $4)`,
        [
          record.id,
          submissionTimelineBody({
            submitterName: request.user.name,
            submittedAt: record.created_at,
            ownerName: owner.ownerName
          }),
          request.user.id,
          request.user.name
        ]
      );
      await client.query(
        `INSERT INTO audit_logs (record_id, entity_type, entity_id, action, new_value, actor_user_id, actor_name)
         VALUES ($1, 'record', $5, 'create', $2, $3, $4)`,
        [record.id, JSON.stringify(mergedValues), request.user.id, request.user.name, record.id]
      );
      return { ...record, form_type_name: formType.name };
    });

    await trySendNotification(created.id, {
      eventKey: "record_created",
      title: `新${recordTypeTitle(created.type_key, created.form_type_name)}：${created.title}`,
      body: `系统：${created.system_name}\n负责人：${created.owner_name}`,
      submitterFeishuUserId: request.user.feishuUserId,
      ownerFeishuUserId: created.owner_feishu_user_id
    });

    await tryCreateFeishuRecord(created);

    return summarizeRecord(created);
  });

  app.patch("/api/records/:id", async (request) => {
    systemWorkerOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateRecordSchema.parse(request.body);
    const updated = await withTransaction(async (client) => {
      const currentResult = await client.query<any>("SELECT * FROM records WHERE id = $1 FOR UPDATE", [params.id]);
      const current = currentResult.rows[0];
      if (!current) throw app.httpErrors.notFound("Record not found.");
      if (isInnovationRecord(current)) throw app.httpErrors.notFound("Innovation records are only editable in Innovation Studio.");
      if (!canViewRecord(request.user, current)) throw app.httpErrors.forbidden("No access to this record.");

      const formType = await getFormType(current.type_key, client);
      if (!formType) throw app.httpErrors.badRequest("Missing form type.");
      const currentValues = (current.values ?? {}) as Record<string, unknown>;
      const nextValues = { ...currentValues, ...body.values };
      const fields = await getFieldConfigs(current.type_key);
      const automaticStatus = statusFromWorkflowValues(nextValues, fields, Object.keys(body.values), formType.statusFieldKey);
      const nextStatus = automaticStatus ?? String(nextValues[formType.statusFieldKey] ?? current.status);
      nextValues[formType.statusFieldKey] = nextStatus;
      const nextTitle = String(nextValues[formType.titleFieldKey] ?? current.title);
      const nextSystemName = String(nextValues[formType.systemFieldKey] ?? current.system_name);
      const owner = nextSystemName === current.system_name
        ? { ownerName: current.owner_name, ownerFeishuUserId: current.owner_feishu_user_id }
        : await getOwnerForSystem(nextSystemName, client);

      const result = await client.query(
        `UPDATE records
            SET title = $2,
                system_name = $3,
                status = $4,
                owner_name = $5,
                owner_feishu_user_id = $6,
                values = $7,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [params.id, nextTitle, nextSystemName, nextStatus, owner.ownerName, owner.ownerFeishuUserId, JSON.stringify(nextValues)]
      );

      for (const [fieldKey, newValue] of Object.entries(body.values)) {
        await client.query(
          `INSERT INTO audit_logs (record_id, entity_type, entity_id, action, field_key, old_value, new_value, actor_user_id, actor_name)
           VALUES ($1, 'record', $7, 'update', $2, $3, $4, $5, $6)`,
          [
            params.id,
            fieldKey,
            JSON.stringify(currentValues[fieldKey] ?? null),
            JSON.stringify(newValue ?? null),
            request.user.id,
            request.user.name,
            params.id
          ]
        );
      }
      if (nextStatus !== current.status) {
        if (body.values[formType.statusFieldKey] === undefined) {
          await client.query(
            `INSERT INTO audit_logs (record_id, entity_type, entity_id, action, field_key, old_value, new_value, actor_user_id, actor_name)
             VALUES ($1, 'record', $7, 'auto_update', $2, $3, $4, $5, $6)`,
            [
              params.id,
              formType.statusFieldKey,
              JSON.stringify(current.status),
              JSON.stringify(nextStatus),
              request.user.id,
              request.user.name,
              params.id
            ]
          );
        }
        await client.query(
          `INSERT INTO timeline_events (record_id, event_type, title, body, actor_user_id, actor_name)
           VALUES ($1, 'status_changed', '状态已更新', $2, $3, $4)`,
          [params.id, `${current.status} -> ${nextStatus}`, request.user.id, request.user.name]
        );
      }
      return { ...result.rows[0], status_changed: nextStatus !== current.status };
    });
    await tryUpdateFeishuRecord(updated);
    if (updated.status_changed && updated.status !== "待处理") {
      await trySendNotification(updated.id, {
        eventKey: "status_changed",
        title: `状态更新：${updated.title}`,
        body: `系统：${updated.system_name}\n状态：${updated.status}\n负责人：${updated.owner_name ?? "未分派"}`,
        submitterFeishuUserId: updated.values?.submitter_feishu_user_id ?? null,
        ownerFeishuUserId: updated.owner_feishu_user_id
      });
    }
    return summarizeRecord(updated);
  });

  app.delete("/api/records/:id", async (request) => {
    systemWorkerOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const currentResult = await query<any>("SELECT * FROM records WHERE id = $1", [params.id]);
    const current = currentResult.rows[0];
    if (!current) throw app.httpErrors.notFound("Record not found.");
    if (isInnovationRecord(current)) return app.httpErrors.notFound("Innovation records are only editable in Innovation Studio.");
    let feishuCleanup: { deletedCount: number; errors: string[] } | null = null;
    let feishuDeleteError: string | null = null;
    if (current.feishu_record_id) {
      try {
        await deleteFeishuRecord(current.type_key, current.feishu_record_id);
      } catch (error) {
        feishuDeleteError = error instanceof Error ? error.message : "飞书多维表格删除失败";
      }
    }
    if (!current.feishu_record_id || feishuDeleteError) {
      feishuCleanup = await cleanupFeishuRecordFallback(current);
    }
    const deleted = await withTransaction(async (client) => {
      const currentResult = await client.query<any>("SELECT * FROM records WHERE id = $1 FOR UPDATE", [params.id]);
      const current = currentResult.rows[0];
      if (!current) throw app.httpErrors.notFound("Record not found.");
      await client.query(
        `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, actor_user_id, actor_name)
         VALUES ('record', $1, 'delete', $2, $3, $4)`,
        [params.id, JSON.stringify(current), request.user.id, request.user.name]
      );
      if (feishuDeleteError || feishuCleanup?.errors.length) {
        await client.query(
          `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, actor_user_id, actor_name)
           VALUES ('record', $1, 'feishu_delete_warning', $2, $3, $4, $5)`,
          [
            params.id,
            JSON.stringify({ feishuDeleteError }),
            JSON.stringify(feishuCleanup ?? null),
            request.user.id,
            request.user.name
          ]
        );
      }
      await client.query("DELETE FROM records WHERE id=$1", [params.id]);
      return current;
    });
    return {
      ok: true,
      id: deleted.id,
      recordNo: deleted.record_no ?? null,
      feishuDeletedCount: feishuCleanup?.deletedCount ?? (current.feishu_record_id && !feishuDeleteError ? 1 : 0),
      feishuWarning: feishuDeleteError
    };
  });

  app.post("/api/admin/records/bulk-delete", async (request) => {
    adminOnly(request.user.role);
    const body = z.object({ recordIds: z.array(z.string().uuid()).min(1) }).parse(request.body);
    const uniqueIds = [...new Set(body.recordIds)];
    const currentResult = await query<any>("SELECT * FROM records WHERE id = ANY($1::uuid[])", [uniqueIds]);
    if (currentResult.rows.some(isInnovationRecord)) {
      return app.httpErrors.badRequest("创新工作室项目请在创新工作室页面管理。");
    }
    let feishuWarnings = 0;
    const cleanupResults: Record<string, unknown> = {};

    for (const record of currentResult.rows) {
      let warning: string | null = null;
      let cleanup: { deletedCount: number; errors: string[] } | null = null;
      if (record.feishu_record_id) {
        try {
          await deleteFeishuRecord(record.type_key, record.feishu_record_id);
        } catch (error) {
          warning = error instanceof Error ? error.message : "飞书多维表格删除失败";
        }
      }
      if (!record.feishu_record_id || warning) {
        cleanup = await cleanupFeishuRecordFallback(record);
      }
      if (warning || cleanup?.errors.length) feishuWarnings += 1;
      cleanupResults[record.id] = { warning, cleanup };
    }

    const deleted = await withTransaction(async (client) => {
      for (const record of currentResult.rows) {
        await client.query(
          `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, actor_user_id, actor_name)
           VALUES ('record', $1, 'bulk_delete', $2, $3, $4, $5)`,
          [
            record.id,
            JSON.stringify(record),
            JSON.stringify(cleanupResults[record.id] ?? null),
            request.user.id,
            request.user.name
          ]
        );
      }
      const result = await client.query("DELETE FROM records WHERE id = ANY($1::uuid[])", [currentResult.rows.map((record) => record.id)]);
      return result.rowCount ?? 0;
    });

    return { ok: true, requested: uniqueIds.length, deleted, feishuWarnings };
  });

  app.post("/api/records/:id/clone-systems", async (request) => {
    systemWorkerOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ systems: z.array(z.string().min(1)).min(1) }).parse(request.body);
    const created = await withTransaction(async (client) => {
      const currentResult = await client.query<any>("SELECT * FROM records WHERE id = $1", [params.id]);
      const current = currentResult.rows[0];
      if (!current) throw app.httpErrors.notFound("Record not found.");
      if (isInnovationRecord(current)) throw app.httpErrors.notFound("Innovation records are only editable in Innovation Studio.");
      const formType = await getFormType(current.type_key, client);
      if (!formType) throw app.httpErrors.badRequest("Missing form type.");
      const baseValues = current.values ?? {};
      const createdRows = [];
      for (const systemName of [...new Set(body.systems.map((item) => item.trim()).filter(Boolean))]) {
        if (systemName === current.system_name) continue;
        const owner = await getOwnerForSystem(systemName, client);
        const recordNo = await generateRecordNo(client, current.type_key, formType.name);
        const nextValues = {
          ...baseValues,
          record_no: recordNo,
          [formType.systemFieldKey]: systemName,
          system_owner: owner.ownerName
        };
        const result = await client.query<any>(
          `INSERT INTO records (record_no, type_key, title, system_name, status, priority, submitter_user_id,
                                submitter_name, owner_name, owner_feishu_user_id, values)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            recordNo,
            current.type_key,
            current.title,
            systemName,
            current.status,
            current.priority,
            current.submitter_user_id,
            current.submitter_name,
            owner.ownerName,
            owner.ownerFeishuUserId,
            JSON.stringify(nextValues)
          ]
        );
        const row = result.rows[0];
        createdRows.push({ ...row, form_type_name: formType.name });
        await client.query(
          `INSERT INTO timeline_events (record_id, event_type, title, body, actor_user_id, actor_name)
           VALUES ($1, 'record_created', '多系统记录已生成', $2, $3, $4)`,
          [
            row.id,
            submissionTimelineBody({
              submitterName: current.submitter_name,
              submittedAt: row.created_at,
              ownerName: owner.ownerName,
              extra: `来源记录：${current.record_no ?? current.title}`
            }),
            request.user.id,
            request.user.name
          ]
        );
      }
      return createdRows;
    });
    for (const record of created) {
      await tryCreateFeishuRecord(record);
      await trySendNotification(record.id, {
        eventKey: "record_created",
        title: `新${recordTypeTitle(record.type_key, record.form_type_name)}：${record.title}`,
        body: `系统：${record.system_name}\n负责人：${record.owner_name}`,
        submitterFeishuUserId: record.values?.submitter_feishu_user_id ?? null,
        ownerFeishuUserId: record.owner_feishu_user_id
      });
    }
    if (!created.length) return [];
    const refreshed = await query<any>(
      "SELECT * FROM records WHERE id = ANY($1::uuid[]) ORDER BY created_at DESC",
      [created.map((record) => record.id)]
    );
    return refreshed.rows.map(summarizeRecord);
  });

  app.post("/api/records/:id/convert", async (request) => {
    systemWorkerOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ typeKey: z.string().min(1) }).parse(request.body);
    if (body.typeKey === INNOVATION_TYPE_KEY) {
      return app.httpErrors.badRequest("创新工作室项目请在创新工作室页面管理。");
    }
    const conversion = await withTransaction(async (client) => {
      const currentResult = await client.query<any>("SELECT * FROM records WHERE id = $1 FOR UPDATE", [params.id]);
      const current = currentResult.rows[0];
      if (!current) throw app.httpErrors.notFound("Record not found.");
      if (isInnovationRecord(current)) throw app.httpErrors.notFound("Innovation records are only editable in Innovation Studio.");
      if (current.type_key === body.typeKey) return { updated: current, oldTypeKey: null, oldFeishuRecordId: null };
      const targetType = await getFormType(body.typeKey, client);
      if (!targetType) throw app.httpErrors.badRequest("Target form type not found.");
      const sourceValues = current.values ?? {};
      const nextValues = {
        ...sourceValues,
        [targetType.titleFieldKey]: current.title,
        [targetType.systemFieldKey]: current.system_name,
        [targetType.statusFieldKey]: current.status
      };
      const result = await client.query<any>(
        `UPDATE records
            SET type_key=$2,
                values=$3,
                feishu_record_id=NULL,
                updated_at=now()
          WHERE id=$1
          RETURNING *`,
        [params.id, body.typeKey, JSON.stringify(nextValues)]
      );
      await client.query(
        `INSERT INTO timeline_events (record_id, event_type, title, body, actor_user_id, actor_name)
         VALUES ($1, 'type_converted', '提交类型已转换', $2, $3, $4)`,
        [params.id, `${recordTypeTitle(current.type_key)} -> ${recordTypeTitle(body.typeKey, targetType.name)}`, request.user.id, request.user.name]
      );
      return { updated: result.rows[0], oldTypeKey: current.type_key, oldFeishuRecordId: current.feishu_record_id ?? null };
    });
    await tryCreateFeishuRecord(conversion.updated);
    if (conversion.oldTypeKey && conversion.oldFeishuRecordId) {
      try {
        await deleteFeishuRecord(conversion.oldTypeKey, conversion.oldFeishuRecordId);
      } catch (error) {
        await query(
          `INSERT INTO timeline_events (record_id, event_type, title, body)
           VALUES ($1, 'feishu_sync_failed', '飞书原记录删除失败', $2)`,
          [conversion.updated.id, error instanceof Error ? error.message : "未知错误"]
        );
        throw app.httpErrors.badGateway(error instanceof Error ? error.message : "飞书原记录删除失败");
      }
    }
    const fresh = await query<any>("SELECT * FROM records WHERE id = $1", [conversion.updated.id]);
    return summarizeRecord(fresh.rows[0] ?? conversion.updated);
  });

  app.post("/api/records/:id/comments", async (request) => {
    systemWorkerOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ body: z.string().min(1) }).parse(request.body);
    const recordResult = await query<any>("SELECT * FROM records WHERE id = $1", [params.id]);
    const record = recordResult.rows[0];
    if (!record) return app.httpErrors.notFound("Record not found.");
    if (isInnovationRecord(record)) return app.httpErrors.notFound("Innovation records are only editable in Innovation Studio.");
    if (!canViewRecord(request.user, record)) return app.httpErrors.forbidden("No access to this record.");
    const comment = await query<any>(
      `INSERT INTO comments (record_id, author_user_id, author_name, body)
       VALUES ($1,$2,$3,$4) RETURNING id, author_name, body, created_at`,
      [params.id, request.user.id, request.user.name, body.body]
    );
    await query(
      `INSERT INTO timeline_events (record_id, event_type, title, body, actor_user_id, actor_name)
       VALUES ($1, 'comment_added', '新增评论', $2, $3, $4)`,
      [params.id, body.body, request.user.id, request.user.name]
    );
    return {
      id: comment.rows[0].id,
      authorName: comment.rows[0].author_name,
      body: comment.rows[0].body,
      createdAt: comment.rows[0].created_at
    };
  });

  app.post("/api/access-requests", async (request) => {
    const body = accessRequestSchema.parse(request.body);
    const result = await query(
      `INSERT INTO access_requests (feishu_user_id, applicant_name, reason)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [body.feishuUserId, body.applicantName, body.reason]
    );
    return result.rows[0];
  });

  app.get("/api/admin/field-configs", async (request) => {
    adminOnly(request.user.role);
    const result = await query(
      `SELECT field_configs.*
         FROM field_configs
         JOIN form_types ON form_types.key = field_configs.form_type_key
        WHERE form_types.enabled = true
        ORDER BY field_configs.form_type_key, field_configs.sort_order, field_configs.label`
    );
    return result.rows;
  });

  app.post("/api/admin/field-configs", async (request) => {
    adminOnly(request.user.role);
    const body = z.object({
      formTypeKey: z.string().min(1),
      fieldKey: z.string().optional(),
      label: z.string().min(1),
      kind: z.enum(["text", "textarea", "date", "select", "person", "attachment", "number", "boolean"]),
      required: z.boolean().default(false),
      visibleToBusiness: z.boolean().default(true),
      editableByBusiness: z.boolean().default(true),
      businessVisible: z.boolean().default(true),
      internal: z.boolean().default(false),
      showInList: z.boolean().default(false),
      sortOrder: z.number().optional(),
      options: z.array(z.string()).default([]),
      createBitableField: z.boolean().default(true)
    }).parse(request.body);

    const formType = await query<any>("SELECT * FROM form_types WHERE key = $1", [body.formTypeKey]);
    if (!formType.rows[0]) return app.httpErrors.notFound("Form type not found.");
    const fieldKey = body.fieldKey?.trim() || fieldKeyFromLabel(body.label);
    if (body.createBitableField) {
      const tableId = formType.rows[0].feishu_table_id || feishuService.tableIdForType(body.formTypeKey);
      if (tableId) {
        await feishuService.createBitableField(tableId, {
          fieldName: body.label,
          type: bitableFieldType(body.kind),
          property: bitableFieldProperty(body.kind, body.options)
        });
      }
    }

    const result = await query<any>(
      `INSERT INTO field_configs (form_type_key, field_key, label, kind, required, visible_to_business, editable_by_business, business_visible, internal, show_in_list, sort_order, options, feishu_field_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM field_configs WHERE form_type_key = $1)),$12,$3)
       RETURNING *`,
      [
        body.formTypeKey,
        fieldKey,
        body.label,
        body.kind,
        body.required,
        body.visibleToBusiness,
        body.editableByBusiness,
        body.businessVisible,
        body.internal,
        body.showInList,
        body.sortOrder ?? null,
        JSON.stringify(body.options)
      ]
    );
    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, actor_user_id, actor_name)
       VALUES ('field_config', $1, 'create', $2, $3, $4)`,
      [result.rows[0].id, JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    return result.rows[0];
  });

  app.patch("/api/admin/field-configs/:id", async (request) => {
    adminOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      required: z.boolean().optional(),
      visibleToBusiness: z.boolean().optional(),
      editableByBusiness: z.boolean().optional(),
      businessVisible: z.boolean().optional(),
      internal: z.boolean().optional(),
      showInList: z.boolean().optional(),
      sortOrder: z.number().optional(),
      options: z.array(z.string()).optional()
    }).parse(request.body);
    const current = await query<any>("SELECT * FROM field_configs WHERE id = $1", [params.id]);
    if (!current.rows[0]) return app.httpErrors.notFound("Field config not found.");
    const next: any = { ...current.rows[0] };
    if (body.required !== undefined) next.required = body.required;
    if (body.visibleToBusiness !== undefined) next.visible_to_business = body.visibleToBusiness;
    if (body.editableByBusiness !== undefined) next.editable_by_business = body.editableByBusiness;
    if (body.businessVisible !== undefined) next.business_visible = body.businessVisible;
    if (body.internal !== undefined) next.internal = body.internal;
    if (body.showInList !== undefined) next.show_in_list = body.showInList;
    if (body.sortOrder !== undefined) next.sort_order = body.sortOrder;
    if (body.options !== undefined) next.options = body.options;
    const result = await query<any>(
      `UPDATE field_configs
          SET required=$2, visible_to_business=$3, editable_by_business=$4, business_visible=$5, internal=$6,
              show_in_list=$7, sort_order=$8, options=$9, updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [params.id, next.required, next.visible_to_business, next.editable_by_business, next.business_visible, next.internal, next.show_in_list, next.sort_order, JSON.stringify(next.options)]
    );
    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, actor_user_id, actor_name)
       VALUES ('field_config', $1, 'update', $2, $3, $4, $5)`,
      [params.id, JSON.stringify(current.rows[0]), JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    return result.rows[0];
  });

  app.get("/api/admin/access-requests", async (request) => {
    adminOnly(request.user.role);
    const result = await query("SELECT * FROM access_requests ORDER BY created_at DESC");
    return result.rows;
  });

  app.patch("/api/admin/access-requests/:id", async (request) => {
    adminOnly(request.user.role);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ status: z.enum(["approved", "rejected"]), reviewNote: z.string().optional() }).parse(request.body);
    const result = await query<any>(
      `UPDATE access_requests
          SET status=$2, review_note=$3, reviewer_user_id=$4, reviewed_at=now()
        WHERE id=$1
        RETURNING *`,
      [params.id, body.status, body.reviewNote ?? null, request.user.id]
    );
    if (!result.rows[0]) return app.httpErrors.notFound("Access request not found.");
    if (body.status === "approved") {
      await query(
        `INSERT INTO users (feishu_user_id, name, role, access_status)
         VALUES ($1,$2,'external','active')
         ON CONFLICT (feishu_user_id) DO UPDATE SET access_status='active', updated_at=now()`,
        [result.rows[0].feishu_user_id, result.rows[0].applicant_name]
      );
    }
    return result.rows[0];
  });

  app.post("/api/feishu/callback", async (request) => {
    const body = request.body as any;
    if (body?.challenge) return { challenge: body.challenge };
    return { ok: true };
  });

  app.get("/api/feishu/status", async () => feishuService.checkConnection());

  app.post("/api/feishu/test-message", async (request) => {
    adminOnly(request.user.role);
    const body = z.object({
      receiveId: z.string().min(1),
      receiveIdType: z.enum(["open_id", "user_id", "union_id", "email", "chat_id"]).default("user_id"),
      text: z.string().min(1).default("IT 揭榜台飞书消息测试")
    }).parse(request.body);

    return feishuService.sendTextMessage(body);
  });

  app.get("/api/feishu/bitable/status", async () => feishuService.bitableStatus());

  app.get("/api/admin/feishu/bitable-link", async (request) => {
    adminOnly(request.user.role);
    const fallbackUrl = config.feishu.bitableAppToken
      ? `https://feishu.cn/base/${encodeURIComponent(config.feishu.bitableAppToken)}${config.feishu.demandTableId ? `/table/${encodeURIComponent(config.feishu.demandTableId)}` : ""}`
      : null;
    return {
      url: config.feishu.bitableWebUrl || fallbackUrl,
      configured: Boolean(config.feishu.bitableWebUrl),
      fallback: !config.feishu.bitableWebUrl && Boolean(fallbackUrl),
      message: config.feishu.bitableWebUrl
        ? "已配置飞书多维表格打开链接。"
        : "未配置 FEISHU_BITABLE_WEB_URL，已按 app_token 生成默认打开链接。"
    };
  });

  app.get("/api/feishu/bitable/tables", async (request) => {
    adminOnly(request.user.role);
    return feishuService.listBitableTables();
  });

  app.get("/api/feishu/bitable/tables/:tableId/fields", async (request) => {
    adminOnly(request.user.role);
    const params = z.object({ tableId: z.string().min(1) }).parse(request.params);
    return feishuService.listBitableFields(params.tableId);
  });

  app.get("/api/feishu/bitable/tables/:tableId/records", async (request) => {
    adminOnly(request.user.role);
    const params = z.object({ tableId: z.string().min(1) }).parse(request.params);
    const queryParams = z.object({ pageSize: z.coerce.number().int().min(1).max(100).default(10) }).parse(request.query);
    return feishuService.listBitableRecords(params.tableId, queryParams.pageSize);
  });
}
