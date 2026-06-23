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
  businessVisible: z.boolean(),
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
  recordNo: z.string().nullable(),
  typeKey: z.string(),
  title: z.string(),
  systemName: z.string(),
  status: z.string(),
  priority: z.string().nullable(),
  submitterUserId: z.string().nullable(),
  submitterFeishuUserId: z.string().nullable(),
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

export const innovationTypeSchema = z.enum(["创新建议", "创新需求"]);
export type InnovationType = z.infer<typeof innovationTypeSchema>;

export const innovationStatusOptions = [
  "待评审",
  "概念验证",
  "项目试点",
  "全面开展",
  "暂未入选（感谢你的创新提案）"
] as const;
export const innovationStatusSchema = z.enum(innovationStatusOptions);
export type InnovationStatus = z.infer<typeof innovationStatusSchema>;

export const innovationProjectInputSchema = z.object({
  projectTheme: z.string().min(1),
  projectDescription: z.string().min(1),
  innovationKind: innovationTypeSchema,
  leaderName: z.string().optional().nullable(),
  leaderUserId: z.string().optional().nullable(),
  estimatedDemandCost: z.union([z.string(), z.number()]).optional().nullable()
});
export type InnovationProjectInput = z.infer<typeof innovationProjectInputSchema>;

export const innovationSupplementInputSchema = z.object({
  leaderName: z.string().optional().nullable(),
  leaderUserId: z.string().optional().nullable(),
  participants: z.string().optional().nullable(),
  participantsUserIds: z.array(z.string()).optional().nullable(),
  workshopResources: z.string().optional().nullable(),
  expectedCost: z.union([z.string(), z.number()]).optional().nullable(),
  expectedCycle: z.string().optional().nullable(),
  status: innovationStatusSchema.optional()
});
export type InnovationSupplementInput = z.infer<typeof innovationSupplementInputSchema>;

export const innovationAwardOptions = ["好点子", "好方案", "好收益"] as const;
export const innovationAwardOptionSchema = z.enum(innovationAwardOptions);
export type InnovationAwardOption = z.infer<typeof innovationAwardOptionSchema>;

export const innovationAwardInputSchema = z.object({
  recordId: z.string().uuid(),
  awardNames: z.array(innovationAwardOptionSchema).min(1),
  reason: z.string().optional().nullable(),
  displayOrder: z.number().int().optional()
});
export type InnovationAwardInput = z.infer<typeof innovationAwardInputSchema>;

export const innovationArticleInputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional().default(""),
  body: z.string().optional().default(""),
  coverImageUrl: z.string().optional().nullable(),
  attachments: z.array(z.unknown()).optional().default([]),
  status: z.enum(["draft", "published", "archived"]).default("draft")
});
export type InnovationArticleInput = z.infer<typeof innovationArticleInputSchema>;

export const innovationAwardSchema = z.object({
  id: z.string(),
  recordId: z.string(),
  awardName: z.string(),
  awardType: z.string().nullable(),
  reason: z.string().nullable(),
  displayOrder: z.number(),
  awardedByName: z.string(),
  awardedAt: z.string()
});
export type InnovationAward = z.infer<typeof innovationAwardSchema>;

export const innovationProjectSchema = z.object({
  id: z.string(),
  recordNo: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  submitterUserId: z.string().nullable(),
  submitterFeishuUserId: z.string().nullable(),
  submitterName: z.string(),
  ownerName: z.string().nullable(),
  values: z.record(z.unknown()),
  awards: z.array(innovationAwardSchema),
  timeline: recordDetailSchema.shape.timeline.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type InnovationProject = z.infer<typeof innovationProjectSchema>;

export const innovationArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  coverImageUrl: z.string().nullable(),
  attachments: z.array(z.unknown()),
  status: z.enum(["draft", "published", "archived"]),
  authorName: z.string(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type InnovationArticle = z.infer<typeof innovationArticleSchema>;
