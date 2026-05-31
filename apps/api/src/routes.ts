import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createRecordSchema, updateRecordSchema, accessRequestSchema } from "@it/shared";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";
import { feishuService } from "./feishu.js";
import {
  canViewRecord,
  getFieldConfigs,
  getFormType,
  getFormTypes,
  getOwnerForSystem,
  listSystemOwners,
} from "./repositories.js";

const adminOnly = (role: string) => {
  if (role !== "admin") {
    const error = new Error("Only administrators can perform this action.");
    (error as any).statusCode = 403;
    throw error;
  }
};

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

function bitableFieldProperty(kind: string, options: string[]) {
  if (kind === "select" && options.length) return { options: options.map((name) => ({ name })) };
  return null;
}

function fieldKeyFromLabel(label: string) {
  const normalized = label
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  return normalized || `field_${randomUUID().slice(0, 8)}`;
}

async function tableIdForType(typeKey: string) {
  const formType = await query<{ feishu_table_id: string | null }>("SELECT feishu_table_id FROM form_types WHERE key = $1", [typeKey]);
  return formType.rows[0]?.feishu_table_id || feishuService.tableIdForType(typeKey);
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
      if (attachments.length) fields[field.feishuFieldName] = attachments;
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
  return {
    id: row.id,
    typeKey: row.type_key,
    title: row.title,
    systemName: row.system_name,
    status: row.status,
    priority: row.priority,
    submitterName: row.submitter_name,
    ownerName: row.owner_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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

async function trySendNotification(recordId: string | null, payload: Parameters<typeof feishuService.sendNotification>[0]) {
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

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.get("/api/uploads/:fileName", async (request, reply) => {
    const params = z.object({ fileName: z.string().min(1) }).parse(request.params);
    const safeName = path.basename(params.fileName);
    const filePath = path.join(config.uploadDir, safeName);
    await fsp.access(filePath);
    return reply.send(fs.createReadStream(filePath));
  });

  app.post("/api/uploads", async (request) => {
    const file = await request.file();
    if (!file) return app.httpErrors.badRequest("No file uploaded.");
    await fsp.mkdir(config.uploadDir, { recursive: true });
    const extension = path.extname(file.filename || "");
    const safeOriginalName = path.basename(file.filename || "attachment").replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
    const storedName = `${Date.now()}-${randomUUID()}${extension}`;
    const filePath = path.join(config.uploadDir, storedName);
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
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
      const table = await feishuService.createBitableTable(`${body.name}记录表`);
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
      { fieldKey: "status", label: "当前状态", kind: "select", required: false, sortOrder: 5, options: ["待处理", "进行中", "状态异常", "已延期", "已关闭"] },
      { fieldKey: "submitter", label: "提交人", kind: "person", required: false, sortOrder: 6 }
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
        `INSERT INTO field_configs (form_type_key, field_key, label, kind, required, visible_to_business, editable_by_business, show_in_list, sort_order, options, feishu_field_name)
         VALUES ($1,$2,$3,$4,$5,true,true,$6,$7,$8,$3)`,
        [body.key, field.fieldKey, field.label, field.kind, field.required, ["title", "system", "status"].includes(field.fieldKey), field.sortOrder, JSON.stringify((field as any).options ?? [])]
      );
    }

    await query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, actor_user_id, actor_name)
       VALUES ('form_type', $1, 'create', $2, $3, $4)`,
      [result.rows[0].id, JSON.stringify(result.rows[0]), request.user.id, request.user.name]
    );
    return result.rows[0];
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
    if (body.ownerName !== undefined) next.owner_name = body.ownerName;
    if (body.ownerFeishuUserId !== undefined) next.owner_feishu_user_id = body.ownerFeishuUserId || null;
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

  app.get("/api/records", async (request) => {
    const queryParams = z.object({
      typeKey: z.string().optional(),
      status: z.string().optional(),
      systemName: z.string().optional()
    }).parse(request.query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (queryParams.typeKey) {
      params.push(queryParams.typeKey);
      conditions.push(`type_key = $${params.length}`);
    }
    if (queryParams.status) {
      params.push(queryParams.status);
      conditions.push(`status = $${params.length}`);
    }
    if (queryParams.systemName) {
      params.push(queryParams.systemName);
      conditions.push(`system_name = $${params.length}`);
    }
    if (request.user.role === "business" || request.user.role === "external") {
      params.push(request.user.id);
      conditions.push(`submitter_user_id = $${params.length}`);
    }
    if (request.user.role === "system_owner") {
      params.push(request.user.name);
      conditions.push(`owner_name = $${params.length}`);
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
    if (!canViewRecord(request.user, record)) return app.httpErrors.forbidden("No access to this record.");

    const [comments, timeline, auditLogs] = await Promise.all([
      query("SELECT id, author_name, body, created_at FROM comments WHERE record_id = $1 ORDER BY created_at", [params.id]),
      query("SELECT id, event_type, title, body, actor_name, created_at FROM timeline_events WHERE record_id = $1 ORDER BY created_at", [params.id]),
      query("SELECT id, field_key, old_value, new_value, actor_name, created_at FROM audit_logs WHERE record_id = $1 ORDER BY created_at DESC LIMIT 100", [params.id])
    ]);

    return {
      ...summarizeRecord(record),
      values: record.values,
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
    const body = createRecordSchema.parse({ ...(request.body as Record<string, unknown>), typeKey: params.typeKey });
    const created = await withTransaction(async (client) => {
      const formType = await getFormType(body.typeKey, client);
      if (!formType) throw app.httpErrors.notFound("Unknown form type.");

      const values = body.values;
      const title = String(values[formType.titleFieldKey] ?? "");
      const systemName = String(values[formType.systemFieldKey] ?? "");
      const status = String(values[formType.statusFieldKey] ?? "待处理");
      if (!title || !systemName) throw app.httpErrors.badRequest("Title and system are required.");

      const owner = await getOwnerForSystem(systemName, client);
      const mergedValues = {
        ...values,
        [formType.submitterFieldKey]: request.user.name,
        [formType.systemFieldKey]: systemName,
        [formType.statusFieldKey]: status,
        system_owner: owner.ownerName
      };
      const result = await client.query(
        `INSERT INTO records (type_key, title, system_name, status, priority, submitter_user_id,
                              submitter_name, owner_name, owner_feishu_user_id, values)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
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
        [record.id, `自动分派给 ${owner.ownerName}`, request.user.id, request.user.name]
      );
      await client.query(
        `INSERT INTO audit_logs (record_id, entity_type, entity_id, action, new_value, actor_user_id, actor_name)
         VALUES ($1, 'record', $5, 'create', $2, $3, $4)`,
        [record.id, JSON.stringify(mergedValues), request.user.id, request.user.name, record.id]
      );
      return record;
    });

    await trySendNotification(created.id, {
      eventKey: "record_created",
      title: `新${created.type_key === "demand" ? "需求" : "问题"}：${created.title}`,
      body: `系统：${created.system_name}\n负责人：${created.owner_name}`,
      submitterFeishuUserId: request.user.feishuUserId,
      ownerFeishuUserId: created.owner_feishu_user_id
    });

    await tryCreateFeishuRecord(created);

    return summarizeRecord(created);
  });

  app.patch("/api/records/:id", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateRecordSchema.parse(request.body);
    const updated = await withTransaction(async (client) => {
      const currentResult = await client.query<any>("SELECT * FROM records WHERE id = $1 FOR UPDATE", [params.id]);
      const current = currentResult.rows[0];
      if (!current) throw app.httpErrors.notFound("Record not found.");
      if (!canViewRecord(request.user, current)) throw app.httpErrors.forbidden("No access to this record.");

      const formType = await getFormType(current.type_key, client);
      if (!formType) throw app.httpErrors.badRequest("Missing form type.");
      const currentValues = (current.values ?? {}) as Record<string, unknown>;
      const nextValues = { ...currentValues, ...body.values };
      const nextStatus = String(nextValues[formType.statusFieldKey] ?? current.status);
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
        await client.query(
          `INSERT INTO timeline_events (record_id, event_type, title, body, actor_user_id, actor_name)
           VALUES ($1, 'status_changed', '状态已更新', $2, $3, $4)`,
          [params.id, `${current.status} -> ${nextStatus}`, request.user.id, request.user.name]
        );
      }
      return result.rows[0];
    });
    await tryUpdateFeishuRecord(updated);
    if (updated.status !== "待处理") {
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

  app.post("/api/records/:id/comments", async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ body: z.string().min(1) }).parse(request.body);
    const recordResult = await query<any>("SELECT * FROM records WHERE id = $1", [params.id]);
    const record = recordResult.rows[0];
    if (!record) return app.httpErrors.notFound("Record not found.");
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
      `SELECT * FROM field_configs ORDER BY form_type_key, sort_order, label`
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
      `INSERT INTO field_configs (form_type_key, field_key, label, kind, required, visible_to_business, editable_by_business, internal, show_in_list, sort_order, options, feishu_field_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM field_configs WHERE form_type_key = $1)),$11,$3)
       RETURNING *`,
      [
        body.formTypeKey,
        fieldKey,
        body.label,
        body.kind,
        body.required,
        body.visibleToBusiness,
        body.editableByBusiness,
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
    if (body.internal !== undefined) next.internal = body.internal;
    if (body.showInList !== undefined) next.show_in_list = body.showInList;
    if (body.sortOrder !== undefined) next.sort_order = body.sortOrder;
    if (body.options !== undefined) next.options = body.options;
    const result = await query<any>(
      `UPDATE field_configs
          SET required=$2, visible_to_business=$3, editable_by_business=$4, internal=$5,
              show_in_list=$6, sort_order=$7, options=$8, updated_at=now()
        WHERE id=$1
        RETURNING *`,
      [params.id, next.required, next.visible_to_business, next.editable_by_business, next.internal, next.show_in_list, next.sort_order, JSON.stringify(next.options)]
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
