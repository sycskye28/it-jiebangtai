ALTER TABLE users
  ADD COLUMN IF NOT EXISTS feishu_open_id TEXT,
  ADD COLUMN IF NOT EXISTS feishu_union_id TEXT,
  ADD COLUMN IF NOT EXISTS employee_no TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE INDEX IF NOT EXISTS idx_users_feishu_open_id ON users(feishu_open_id);
CREATE INDEX IF NOT EXISTS idx_users_employee_no ON users(employee_no);
