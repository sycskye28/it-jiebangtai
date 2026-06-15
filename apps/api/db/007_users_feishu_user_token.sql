ALTER TABLE users
  ADD COLUMN IF NOT EXISTS feishu_user_access_token TEXT,
  ADD COLUMN IF NOT EXISTS feishu_user_token_expires_at TIMESTAMPTZ;
