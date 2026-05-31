import { z } from "zod";

export const recordTypeSchema = z.enum(["demand", "issue"]);
export type RecordTypeKey = z.infer<typeof recordTypeSchema>;

export const fieldKindSchema = z.enum([
  "text",
  "textarea",
  "date",
  "select",
  "person",
  "attachment",
  "number",
  "boolean"
]);
export type FieldKind = z.infer<typeof fieldKindSchema>;

export const roleSchema = z.enum(["business", "system_owner", "admin", "external"]);
export type RoleKey = z.infer<typeof roleSchema>;

export const fieldConfigSchema = z.object({
  id: z.string(),
  formTypeKey: z.string(),
  fieldKey: z.string(),
  label: z.string(),
  kind: fieldKindSchema,
  required: z.boolean(),
  visibleToBusiness: z.boolean(),
  editableByBusiness: z.boolean(),
  internal: z.boolean(),
  showInList: z.boolean(),
  sortOrder: z.number(),
  options: z.array(z.string()).default([]),
  feishuFieldName: z.string().optional()
});
export type FieldConfig = z.infer<typeof fieldConfigSchema>;

export const formTypeSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  titleFieldKey: z.string(),
  systemFieldKey: z.string(),
  submitterFieldKey: z.string(),
  statusFieldKey: z.string(),
  enabled: z.boolean()
});
export type FormType = z.infer<typeof formTypeSchema>;

export const userSchema = z.object({
  id: z.string(),
  feishuUserId: z.string(),
  name: z.string(),
  department: z.string().nullable(),
  role: roleSchema,
  accessStatus: z.enum(["active", "pending", "rejected"])
});
export type CurrentUser = z.infer<typeof userSchema>;

export const recordSummarySchema = z.object({
  id: z.string(),
  typeKey: z.string(),
  title: z.string(),
  systemName: z.string(),
  status: z.string(),
  priority: z.string().nullable(),
  submitterName: z.string(),
  ownerName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type RecordSummary = z.infer<typeof recordSummarySchema>;

export const recordDetailSchema = recordSummarySchema.extend({
  values: z.record(z.unknown()),
  comments: z.array(z.object({
    id: z.string(),
    authorName: z.string(),
    body: z.string(),
    createdAt: z.string()
  })),
  timeline: z.array(z.object({
    id: z.string(),
    eventType: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    actorName: z.string().nullable(),
    createdAt: z.string()
  })),
  auditLogs: z.array(z.object({
    id: z.string(),
    fieldKey: z.string().nullable(),
    oldValue: z.unknown().nullable(),
    newValue: z.unknown().nullable(),
    actorName: z.string().nullable(),
    createdAt: z.string()
  }))
});
export type RecordDetail = z.infer<typeof recordDetailSchema>;

export const createRecordSchema = z.object({
  typeKey: z.string(),
  values: z.record(z.unknown())
});
export type CreateRecordInput = z.infer<typeof createRecordSchema>;

export const updateRecordSchema = z.object({
  values: z.record(z.unknown())
});
export type UpdateRecordInput = z.infer<typeof updateRecordSchema>;

export const accessRequestSchema = z.object({
  applicantName: z.string().min(1),
  feishuUserId: z.string().min(1),
  reason: z.string().min(1)
});
export type AccessRequestInput = z.infer<typeof accessRequestSchema>;

export const notificationEventKeys = [
  "record_created",
  "status_changed",
  "need_more_info",
  "record_closed"
] as const;
export type NotificationEventKey = typeof notificationEventKeys[number];
