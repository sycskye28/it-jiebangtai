CREATE TABLE IF NOT EXISTS admin_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  feishu_user_id TEXT,
  employee_no TEXT,
  note TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_members_feishu_user_id
  ON admin_members (lower(feishu_user_id))
  WHERE feishu_user_id IS NOT NULL AND feishu_user_id <> '';

CREATE INDEX IF NOT EXISTS idx_admin_members_name
  ON admin_members (name);

INSERT INTO admin_members (name, feishu_user_id, employee_no, note, enabled)
VALUES ('沈昀初', 'a10986', 'a10986', '超级管理员保底账号', true)
ON CONFLICT DO NOTHING;
