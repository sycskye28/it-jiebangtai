UPDATE records
   SET owner_feishu_user_id = system_owners.owner_feishu_user_id,
       values = jsonb_set(
         COALESCE(records.values, '{}'::jsonb),
         '{system_owner}',
         to_jsonb(system_owners.owner_name),
         true
       ),
       updated_at = now()
  FROM system_owners
 WHERE records.system_name = system_owners.system_name
   AND system_owners.enabled = true
   AND records.owner_feishu_user_id IS NULL;

INSERT INTO timeline_events (
  record_id,
  event_type,
  title,
  body,
  actor_user_id,
  actor_name,
  created_at
)
SELECT
  records.id,
  'record_created',
  '记录已提交',
  concat_ws(
    E'\n',
    '提交人：' || records.submitter_name,
    '提交时间：' || to_char(records.created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'),
    CASE
      WHEN records.owner_name IS NOT NULL THEN '自动分派给：' || records.owner_name
      ELSE NULL
    END,
    '来源：历史同步记录修复'
  ),
  records.submitter_user_id,
  records.submitter_name,
  records.created_at
FROM records
WHERE NOT EXISTS (
  SELECT 1
    FROM timeline_events
   WHERE timeline_events.record_id = records.id
     AND timeline_events.event_type = 'record_created'
);
