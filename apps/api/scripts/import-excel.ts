import fs from "node:fs/promises";
import path from "node:path";
import xlsx from "xlsx";
import { pool } from "../src/db.js";
import { config } from "../src/config.js";

const workbookPath = process.argv[2] ?? "/Users/sylas/Documents/IT揭榜台/需求及问题 管理 副本.xlsx";

type ReportItem = {
  sheet: string;
  row: number;
  level: "warning" | "error";
  message: string;
};

const report: ReportItem[] = [];

function normalizeValue(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined || value === null) return "";
  return value;
}

function keyFromLabel(label: string) {
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
  return label.replace(/[^\p{Letter}\p{Number}]+/gu, "_").replace(/^_|_$/g, "");
}

async function importOwners(workbook: xlsx.WorkBook) {
  const sheet = workbook.Sheets["各系统管理员对照表"];
  if (!sheet) return;
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  for (const [index, row] of rows.entries()) {
    const systemName = String(row["系统名称"] ?? "").trim();
    const ownerName = String(row["管理员"] ?? "").trim();
    const consultantNames = String(row["顾问"] ?? "").trim();
    if (!systemName || !ownerName) {
      report.push({ sheet: "各系统管理员对照表", row: index + 2, level: "warning", message: "系统名称或管理员为空，已跳过。" });
      continue;
    }
    await pool.query(
      `INSERT INTO system_owners (system_name, owner_name, consultant_names)
       VALUES ($1,$2,$3)
       ON CONFLICT (system_name) DO UPDATE SET owner_name=EXCLUDED.owner_name, consultant_names=EXCLUDED.consultant_names, updated_at=now()`,
      [systemName, ownerName, consultantNames || null]
    );
  }
}

async function ownerFor(systemName: string) {
  const result = await pool.query("SELECT owner_name, owner_feishu_user_id FROM system_owners WHERE system_name=$1 AND enabled=true", [systemName]);
  if (result.rows[0]) return result.rows[0];
  return { owner_name: config.defaultAdminName, owner_feishu_user_id: config.defaultAdminUserId || null };
}

async function importSheet(workbook: xlsx.WorkBook, sheetName: string, typeKey: "demand" | "issue") {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  const formType = await pool.query("SELECT * FROM form_types WHERE key=$1", [typeKey]);
  if (!formType.rows[0]) throw new Error(`Missing form type: ${typeKey}. Run db:seed first.`);
  const type = formType.rows[0];
  for (const [index, row] of rows.entries()) {
    const values: Record<string, unknown> = {};
    for (const [label, value] of Object.entries(row)) {
      values[keyFromLabel(label)] = normalizeValue(value);
    }
    const title = String(values[type.title_field_key] ?? "").trim();
    const systemName = String(values[type.system_field_key] ?? "").trim();
    const status = String(values[type.status_field_key] ?? "待处理").trim() || "待处理";
    const submitterName = String(values[type.submitter_field_key] ?? "历史导入").trim() || "历史导入";
    if (!title) {
      report.push({ sheet: sheetName, row: index + 2, level: "warning", message: "标题为空，已跳过。" });
      continue;
    }
    if (!systemName) {
      report.push({ sheet: sheetName, row: index + 2, level: "warning", message: "系统为空，将分派给默认管理员。" });
    }
    const owner = await ownerFor(systemName);
    if (owner.owner_name === config.defaultAdminName && systemName) {
      report.push({ sheet: sheetName, row: index + 2, level: "warning", message: `系统「${systemName}」未匹配到管理员，已分派给${config.defaultAdminName}。` });
    }
    const migrationKey = `${typeKey}:${sheetName}:${index + 2}:${title}`;
    values.system_owner = owner.owner_name;
    await pool.query(
      `INSERT INTO records (type_key, title, system_name, status, priority, submitter_name, owner_name,
                            owner_feishu_user_id, values, source_migration_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (source_migration_key) DO UPDATE SET
         title=EXCLUDED.title,
         system_name=EXCLUDED.system_name,
         status=EXCLUDED.status,
         priority=EXCLUDED.priority,
         submitter_name=EXCLUDED.submitter_name,
         owner_name=EXCLUDED.owner_name,
         owner_feishu_user_id=EXCLUDED.owner_feishu_user_id,
         values=EXCLUDED.values,
         updated_at=now()`,
      [
        typeKey,
        title,
        systemName || "未填写",
        status,
        String(values.priority ?? "") || null,
        submitterName,
        owner.owner_name,
        owner.owner_feishu_user_id,
        JSON.stringify(values),
        migrationKey
      ]
    );
  }
}

try {
  await fs.access(workbookPath);
  const workbook = xlsx.readFile(workbookPath, { cellDates: true });
  await importOwners(workbook);
  await importSheet(workbook, "新增需求管理", "demand");
  await importSheet(workbook, "系统问题管理", "issue");
  const reportPath = path.resolve(process.cwd(), `import-report-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify({ workbookPath, report }, null, 2));
  console.info(`import completed with ${report.length} report item(s)`);
  console.info(reportPath);
} finally {
  await pool.end();
}
