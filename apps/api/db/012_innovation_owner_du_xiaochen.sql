INSERT INTO system_owners (system_name, owner_name, owner_feishu_user_id, consultant_names, enabled)
VALUES ('数字化创新工作室', '杜晓晨', 'a10890', NULL, true)
ON CONFLICT (system_name) DO UPDATE SET
  owner_name = EXCLUDED.owner_name,
  owner_feishu_user_id = EXCLUDED.owner_feishu_user_id,
  enabled = true,
  updated_at = now();

UPDATE records
   SET owner_name = '杜晓晨',
       owner_feishu_user_id = 'a10890',
       values = jsonb_set(
         COALESCE(values, '{}'::jsonb),
         '{system_owner}',
         to_jsonb('杜晓晨'::text),
         true
       ),
       updated_at = now()
 WHERE type_key = 'innovation_studio'
   AND system_name = '数字化创新工作室';
