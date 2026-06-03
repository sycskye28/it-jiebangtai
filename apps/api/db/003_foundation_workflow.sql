ALTER TABLE field_configs
  ADD COLUMN IF NOT EXISTS business_visible BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE records
  ADD COLUMN IF NOT EXISTS record_no TEXT;

CREATE TABLE IF NOT EXISTS record_counters (
  counter_key TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

WITH numbered AS (
  SELECT
    records.id,
    form_types.name || '-' || to_char(records.created_at AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD') || '-' ||
      lpad(row_number() OVER (
        PARTITION BY records.type_key, to_char(records.created_at AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD')
        ORDER BY records.created_at, records.id
      )::text, 3, '0') AS generated_no
  FROM records
  JOIN form_types ON form_types.key = records.type_key
  WHERE records.record_no IS NULL
)
UPDATE records
   SET record_no = numbered.generated_no,
       values = jsonb_set(records.values, '{record_no}', to_jsonb(numbered.generated_no), true)
  FROM numbered
 WHERE records.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_records_record_no ON records(record_no);
