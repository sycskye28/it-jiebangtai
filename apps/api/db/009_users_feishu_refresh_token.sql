ALTER TABLE users
  ADD COLUMN IF NOT EXISTS feishu_user_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS feishu_user_refresh_expires_at TIMESTAMPTZ;
