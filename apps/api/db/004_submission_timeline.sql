UPDATE timeline_events AS timeline
   SET body = concat_ws(
         E'\n',
         '提交人：' || records.submitter_name,
         '提交时间：' || to_char(records.created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS'),
         NULLIF(timeline.body, '')
       ),
       actor_user_id = COALESCE(timeline.actor_user_id, records.submitter_user_id),
       actor_name = COALESCE(timeline.actor_name, records.submitter_name)
  FROM records
 WHERE timeline.record_id = records.id
   AND timeline.event_type = 'record_created';

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
    END
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
