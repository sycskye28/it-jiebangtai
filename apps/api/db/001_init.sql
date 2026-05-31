CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feishu_user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department TEXT,
  role TEXT NOT NULL DEFAULT 'business',
  access_status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feishu_user_id TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_user_id UUID REFERENCES users(id),
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS form_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  title_field_key TEXT NOT NULL,
  system_field_key TEXT NOT NULL,
  submitter_field_key TEXT NOT NULL,
  status_field_key TEXT NOT NULL,
  feishu_table_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS field_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_type_key TEXT NOT NULL REFERENCES form_types(key) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  visible_to_business BOOLEAN NOT NULL DEFAULT true,
  editable_by_business BOOLEAN NOT NULL DEFAULT true,
  internal BOOLEAN NOT NULL DEFAULT false,
  show_in_list BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  feishu_field_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(form_type_key, field_key)
);

CREATE TABLE IF NOT EXISTS system_owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_name TEXT NOT NULL UNIQUE,
  owner_name TEXT NOT NULL,
  owner_feishu_user_id TEXT,
  consultant_names TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  recipients JSONB NOT NULL DEFAULT '["submitter","system_owner"]'::jsonb,
  template TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_key)
);

CREATE TABLE IF NOT EXISTS records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key TEXT NOT NULL REFERENCES form_types(key),
  title TEXT NOT NULL,
  system_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '待处理',
  priority TEXT,
  submitter_user_id UUID REFERENCES users(id),
  submitter_name TEXT NOT NULL,
  owner_name TEXT,
  owner_feishu_user_id TEXT,
  values JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_migration_key TEXT UNIQUE,
  feishu_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES users(id),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  actor_user_id UUID REFERENCES users(id),
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID REFERENCES records(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  field_key TEXT,
  old_value JSONB,
  new_value JSONB,
  actor_user_id UUID REFERENCES users(id),
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_records_type ON records(type_key);
CREATE INDEX IF NOT EXISTS idx_records_system ON records(system_name);
CREATE INDEX IF NOT EXISTS idx_records_owner ON records(owner_name);
CREATE INDEX IF NOT EXISTS idx_records_submitter ON records(submitter_user_id);
CREATE INDEX IF NOT EXISTS idx_records_values ON records USING GIN(values);
