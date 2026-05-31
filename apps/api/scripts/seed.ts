import { pool } from "../src/db.js";
import { config } from "../src/config.js";

type SeedField = {
  fieldKey: string;
  label: string;
  kind: string;
  required?: boolean;
  visibleToBusiness?: boolean;
  editableByBusiness?: boolean;
  internal?: boolean;
  showInList?: boolean;
  sortOrder: number;
  options?: string[];
};

const demandHeaders = [
  "需求名称", "需求描述", "需求附件", "需求提出人", "迭代版本", "需求提出时间", "期望完成时间", "需求排序", "关联单据号", "对应系统", "系统负责人", "系统顾问", "计划开始时间", "预计完成时间", "当前状态", "进展or交付说明", "分析完成节点", "设计完成时间", "开发完成时间", "测试完成时间", "部署完成时间", "验证完成时间", "交付物提交", "方案类型", "需求来源", "分析", "设计文档交付", "设计", "开发", "测试", "部署", "合计人天", "2025是否开发", "开发工时评估", "禅道需求编号", "LMES系统状态", "方案负责人", "优先级", "父记录"
];

const issueHeaders = [
  "问题名称", "问题描述", "问题附件", "问题提出人", "问题提出时间", "期望完成时间", "问题排序", "问题系统", "系统管理员", "系统顾问", "原因分析", "分析完成时间", "临时措施", "长期措施", "进展or交付说明", "计划开始时间", "预计完成时间", "当前状态", "设计完成时间", "开发完成时间", "测试完成时间", "部署上线时间", "验证完成时间", "交付物提交", "Bug 工单群", "建群按钮", "创建时间", "方案类型", "问题来源", "负责人", "禅道需求编号", "LMES系统状态", "父记录", "问题类别"
];

const dateLabels = new Set(["提出时间", "期望完成时间", "计划开始时间", "预计完成时间", "分析完成节点", "分析完成时间", "设计完成时间", "开发完成时间", "测试完成时间", "部署完成时间", "部署上线时间", "验证完成时间", "创建时间"]);
const textAreaLabels = new Set(["需求描述", "问题描述", "进展or交付说明", "原因分析", "临时措施", "长期措施"]);
const attachmentLabels = new Set(["需求附件", "问题附件", "交付物提交"]);
const numberLabels = new Set(["分析", "设计", "开发", "测试", "部署", "合计人天", "开发工时评估"]);

function keyFromLabel(prefix: string, label: string) {
  const known: Record<string, string> = {
    "需求名称": "title",
    "问题名称": "title",
    "需求描述": "description",
    "问题描述": "description",
    "需求附件": "attachments",
    "问题附件": "attachments",
    "需求提出人": "submitter",
    "问题提出人": "submitter",
    "需求提出时间": "submitted_at",
    "问题提出时间": "submitted_at",
    "需求排序": "priority",
    "问题排序": "priority",
    "对应系统": "system",
    "问题系统": "system",
    "系统负责人": "system_owner",
    "系统管理员": "system_owner",
    "当前状态": "status",
    "优先级": "business_priority"
  };
  if (known[label]) return known[label];
  return `${prefix}_${label.replace(/[^\p{Letter}\p{Number}]+/gu, "_").replace(/^_|_$/g, "")}`;
}

function kindFromLabel(label: string) {
  if (attachmentLabels.has(label)) return "attachment";
  if ([...dateLabels].some((item) => label.includes(item))) return "date";
  if (textAreaLabels.has(label)) return "textarea";
  if (numberLabels.has(label)) return "number";
  if (["需求排序", "问题排序", "当前状态", "方案类型", "需求来源", "问题来源", "优先级", "2025是否开发", "LMES系统状态", "问题类别"].includes(label)) return "select";
  if (label.includes("负责人") || label.includes("管理员") || label.includes("顾问") || label.includes("提出人")) return "person";
  return "text";
}

function fields(prefix: string, headers: string[]): SeedField[] {
  return headers.map((label, index) => ({
    fieldKey: keyFromLabel(prefix, label),
    label,
    kind: kindFromLabel(label),
    required: ["需求名称", "问题名称", "对应系统", "问题系统"].includes(label),
    visibleToBusiness: !["系统顾问", "分析", "设计", "开发", "测试", "部署", "合计人天", "开发工时评估", "父记录"].includes(label),
    editableByBusiness: ["需求名称", "需求描述", "需求附件", "期望完成时间", "需求排序", "对应系统", "问题名称", "问题描述", "问题附件", "问题排序", "问题系统", "问题类别"].includes(label),
    internal: ["系统顾问", "分析", "设计", "开发", "测试", "部署", "合计人天", "开发工时评估", "父记录"].includes(label),
    showInList: ["需求名称", "问题名称", "对应系统", "问题系统", "当前状态", "需求排序", "问题排序", "系统负责人", "系统管理员", "优先级"].includes(label),
    sortOrder: index + 1,
    options: optionsFor(label)
  }));
}

function optionsFor(label: string) {
  const options: Record<string, string[]> = {
    "需求排序": ["紧急", "高", "中", "低"],
    "问题排序": ["紧急", "高", "中", "低"],
    "当前状态": ["待处理", "进行中", "状态异常", "已延期", "已关闭"],
    "方案类型": ["临时方案", "过渡方案", "长期方案", "问题解决", "临时措施", "过渡措施", "长期措施"],
    "需求来源": ["业务需求", "项目组输入", "数据治理", "问题解决"],
    "问题来源": ["日常运维", "项目组输入", "停线问题", "数据治理"],
    "优先级": ["重要", "次重要", "不重要", "待变更"],
    "2025是否开发": ["是", "否"],
    "LMES系统状态": ["未开始", "开发中", "顾问测试中", "已上线待验证", "已上线待观察", "已关闭"],
    "问题类别": ["质量", "生产", "改制返工拆解", "工艺", "数采过站", "前端界面问题", "精准扣料", "生产计划", "设备", "库存缺料", "移库", "其他"]
  };
  return options[label] ?? [];
}

const owners = [
  ["DPDM", "蔡桢", ""],
  ["MPPS", "李济涵", ""],
  ["QMS", "郑泽阳", ""],
  ["CMES", "沈昀初", ""],
  ["LMES1.0", "沈昀初", ""],
  ["LMES2.0", "赵峻霆", "用户633023,魏彩玉,用户 ptukt,李嘉,柳文龙,吴健"],
  ["LES", "姚兆祥", ""],
  ["WMS", "姚兆祥", ""],
  ["EBS-完工扣料", "闫汉卿", "段高磊,用户197113"],
  ["CPS", "席国政", ""],
  ["AMTED", "席国政", ""],
  ["SPC", "席国政", ""],
  ["EBS-销售拉料", "兰江", "段高磊,用户197113"],
  ["EBS-财务", "闫汉卿", "段高磊,用户197113"],
  ["MAXIMO", "李哲", ""]
];

try {
  await pool.query("BEGIN");
  await pool.query(
    `INSERT INTO users (feishu_user_id, name, department, role, access_status)
     VALUES ('dev-admin', $1, 'IT', 'admin', 'active')
     ON CONFLICT (feishu_user_id) DO UPDATE SET role='admin', name=EXCLUDED.name, updated_at=now()`,
    [config.defaultAdminName]
  );
  await pool.query(
    `INSERT INTO form_types (key, name, description, title_field_key, system_field_key, submitter_field_key, status_field_key, sort_order)
     VALUES
       ('demand', '需求', '业务部门提交的新需求、优化需求和项目输入。', 'title', 'system', 'submitter', 'status', 1),
       ('issue', '问题', '系统异常、运维问题和业务使用问题。', 'title', 'system', 'submitter', 'status', 2)
     ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, updated_at=now()`
  );

  for (const [formType, seedFields] of [["demand", fields("demand", demandHeaders)], ["issue", fields("issue", issueHeaders)]] as const) {
    for (const field of seedFields) {
      await pool.query(
        `INSERT INTO field_configs (form_type_key, field_key, label, kind, required, visible_to_business,
                                    editable_by_business, internal, show_in_list, sort_order, options, feishu_field_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$3)
         ON CONFLICT (form_type_key, field_key) DO UPDATE SET
           label=EXCLUDED.label,
           kind=EXCLUDED.kind,
           required=EXCLUDED.required,
           visible_to_business=EXCLUDED.visible_to_business,
           editable_by_business=EXCLUDED.editable_by_business,
           internal=EXCLUDED.internal,
           show_in_list=EXCLUDED.show_in_list,
           sort_order=EXCLUDED.sort_order,
           options=EXCLUDED.options,
           feishu_field_name=EXCLUDED.feishu_field_name,
           updated_at=now()`,
        [formType, field.fieldKey, field.label, field.kind, field.required ?? false, field.visibleToBusiness ?? true, field.editableByBusiness ?? true, field.internal ?? false, field.showInList ?? false, field.sortOrder, JSON.stringify(field.options ?? [])]
      );
    }
  }

  for (const [systemName, ownerName, consultantNames] of owners) {
    await pool.query(
      `INSERT INTO system_owners (system_name, owner_name, consultant_names)
       VALUES ($1,$2,$3)
       ON CONFLICT (system_name) DO UPDATE SET owner_name=EXCLUDED.owner_name, consultant_names=EXCLUDED.consultant_names, updated_at=now()`,
      [systemName, ownerName, consultantNames || null]
    );
  }

  const rules = [
    ["record_created", "提交成功", "你有一条新的记录需要关注：{{title}}"],
    ["status_changed", "状态变更", "{{title}} 状态已更新为 {{status}}"],
    ["need_more_info", "需补充信息", "{{title}} 需要提交人补充信息"],
    ["record_closed", "完成关闭", "{{title}} 已完成关闭"]
  ];
  for (const [eventKey, name, template] of rules) {
    await pool.query(
      `INSERT INTO notification_rules (event_key, name, template)
       VALUES ($1,$2,$3)
       ON CONFLICT (event_key) DO UPDATE SET name=EXCLUDED.name, template=EXCLUDED.template, updated_at=now()`,
      [eventKey, name, template]
    );
  }
  await pool.query("COMMIT");
  console.info("seed completed");
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
} finally {
  await pool.end();
}
