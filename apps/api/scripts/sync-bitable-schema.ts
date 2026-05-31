import { feishuService } from "../src/feishu.js";
import { getFieldConfigs } from "../src/repositories.js";

const FIELD_TYPES: Record<string, number> = {
  text: 1,
  textarea: 1,
  person: 1,
  select: 3,
  number: 2,
  date: 5,
  boolean: 7,
  attachment: 17
};

async function syncForm(typeKey: "demand" | "issue") {
  const tableId = feishuService.tableIdForType(typeKey);
  if (!tableId) throw new Error(`Missing table id for ${typeKey}.`);
  const [fields, configs] = await Promise.all([
    feishuService.listBitableFields(tableId),
    getFieldConfigs(typeKey)
  ]);
  const byName = new Map((fields.items ?? []).map((field: any) => [String(field.field_name), field]));
  const results = [];
  for (const config of configs) {
    if (!config.feishuFieldName) continue;
    const bitableField = byName.get(config.feishuFieldName);
    if (!bitableField?.field_id) continue;
    const nextType = FIELD_TYPES[config.kind] ?? 1;
    if (Number((bitableField as any).type) === nextType) continue;
    try {
      await feishuService.updateBitableField(tableId, String((bitableField as any).field_id), {
        fieldName: config.feishuFieldName,
        type: nextType,
        property: config.kind === "select" && config.options.length
          ? { options: config.options.map((name: string) => ({ name })) }
          : null
      });
      results.push({ typeKey, field: config.feishuFieldName, from: (bitableField as any).type, to: nextType, ok: true });
    } catch (error) {
      results.push({
        typeKey,
        field: config.feishuFieldName,
        from: (bitableField as any).type,
        to: nextType,
        ok: false,
        error: error instanceof Error ? error.message : "unknown error"
      });
    }
  }
  return results;
}

const results = [...await syncForm("demand"), ...await syncForm("issue")];
console.info(JSON.stringify(results, null, 2));
