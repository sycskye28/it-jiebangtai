INSERT INTO form_types (
  key,
  name,
  description,
  title_field_key,
  system_field_key,
  submitter_field_key,
  status_field_key,
  sort_order,
  enabled
)
VALUES (
  'innovation_studio',
  '数字化创新工作室',
  '开放包容、自由共创的数字化创新项目入口。',
  'project_theme',
  'studio_scope',
  'submitter',
  'status',
  30,
  true
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  title_field_key = EXCLUDED.title_field_key,
  system_field_key = EXCLUDED.system_field_key,
  submitter_field_key = EXCLUDED.submitter_field_key,
  status_field_key = EXCLUDED.status_field_key,
  enabled = true,
  updated_at = now();

INSERT INTO system_owners (system_name, owner_name, owner_feishu_user_id, consultant_names, enabled)
VALUES ('数字化创新工作室', '杜晓晨', 'a10890', NULL, true)
ON CONFLICT (system_name) DO UPDATE SET
  owner_name = EXCLUDED.owner_name,
  owner_feishu_user_id = EXCLUDED.owner_feishu_user_id,
  enabled = true,
  updated_at = now();

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
  ('innovation_studio', 'project_theme', '项目主题', 'text', true, true, true, true, false, true, 1, '[]'::jsonb, '项目主题'),
  ('innovation_studio', 'project_description', '描述（项目内容，预期收益）', 'textarea', true, true, true, true, false, true, 2, '[]'::jsonb, '描述（项目内容，预期收益）'),
  ('innovation_studio', 'innovation_kind', '类型', 'select', true, true, true, true, false, true, 3, '["创新建议","创新需求"]'::jsonb, '类型'),
  ('innovation_studio', 'leader_name', '牵头人', 'person', false, true, true, true, false, true, 4, '[]'::jsonb, '牵头人'),
  ('innovation_studio', 'estimated_demand_cost', '预计需求费用', 'number', false, true, true, true, false, true, 5, '[]'::jsonb, '预计需求费用'),
  ('innovation_studio', 'participants', '参与人员', 'textarea', false, true, true, true, false, true, 6, '[]'::jsonb, '参与人员'),
  ('innovation_studio', 'workshop_resources', '所需工作室资源', 'textarea', false, true, true, true, false, true, 7, '[]'::jsonb, '所需工作室资源'),
  ('innovation_studio', 'expected_cost', '预期费用', 'number', false, true, true, true, false, true, 8, '[]'::jsonb, '预期费用'),
  ('innovation_studio', 'expected_cycle', '预期周期', 'text', false, true, true, true, false, true, 9, '[]'::jsonb, '预期周期'),
  ('innovation_studio', 'status', '状态', 'select', false, false, false, true, false, true, 10, '["待评审","概念验证","项目试点","全面开展","暂未入选（感谢你的创新提案）"]'::jsonb, '状态'),
  ('innovation_studio', 'submitter', '提交人', 'person', false, false, false, true, false, true, 11, '[]'::jsonb, '提交人'),
  ('innovation_studio', 'submitted_at', '提交时间', 'date', false, false, false, true, false, true, 12, '[]'::jsonb, '提交时间'),
  ('innovation_studio', 'studio_scope', '所属空间', 'text', false, false, false, false, true, false, 13, '[]'::jsonb, '所属空间')
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

CREATE TABLE IF NOT EXISTS innovation_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  award_name TEXT NOT NULL,
  award_type TEXT,
  reason TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  awarded_by_user_id UUID REFERENCES users(id),
  awarded_by_name TEXT NOT NULL,
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_innovation_awards_record ON innovation_awards(record_id);
CREATE INDEX IF NOT EXISTS idx_innovation_awards_display ON innovation_awards(display_order, awarded_at DESC);

CREATE TABLE IF NOT EXISTS innovation_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  author_user_id UUID REFERENCES users(id),
  author_name TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT innovation_articles_status_check CHECK (status IN ('draft', 'published', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_innovation_articles_status_published ON innovation_articles(status, published_at DESC);
