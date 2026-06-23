INSERT INTO field_configs (
  form_type_key,
  field_key,
  label,
  kind,
  required,
  visible_to_business,
  editable_by_business,
  business_visible,
  internal,
  show_in_list,
  sort_order,
  options,
  feishu_field_name
)
VALUES
  ('demand', 'submitter_user_id', '提交人 user_id', 'text', false, false, false, true, false, false, 998, '[]'::jsonb, '提交人 user_id'),
  ('issue', 'submitter_user_id', '提交人 user_id', 'text', false, false, false, true, false, false, 998, '[]'::jsonb, '提交人 user_id'),
  ('innovation_studio', 'submitter_user_id', '提交人 user_id', 'text', false, false, false, true, false, false, 14, '[]'::jsonb, '提交人 user_id'),
  ('innovation_studio', 'leader_user_id', '牵头人 user_id', 'text', false, false, false, true, false, false, 15, '[]'::jsonb, '牵头人 user_id')
ON CONFLICT (form_type_key, field_key) DO UPDATE SET
  label = EXCLUDED.label,
  kind = EXCLUDED.kind,
  required = EXCLUDED.required,
  visible_to_business = EXCLUDED.visible_to_business,
  editable_by_business = EXCLUDED.editable_by_business,
  business_visible = EXCLUDED.business_visible,
  internal = EXCLUDED.internal,
  show_in_list = EXCLUDED.show_in_list,
  sort_order = EXCLUDED.sort_order,
  options = EXCLUDED.options,
  feishu_field_name = EXCLUDED.feishu_field_name,
  updated_at = now();

UPDATE records
   SET values = jsonb_set(values, '{submitter_user_id}', to_jsonb(values->>'submitter_feishu_user_id'), true),
       updated_at = now()
 WHERE type_key IN ('demand', 'issue', 'innovation_studio')
   AND values ? 'submitter_feishu_user_id'
   AND NOT values ? 'submitter_user_id';
