ALTER TABLE admin_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'system_owner';

UPDATE admin_members
   SET role = 'admin'
 WHERE lower(COALESCE(feishu_user_id, '')) = 'a10986'
    OR lower(COALESCE(employee_no, '')) = 'a10986'
    OR name = '沈昀初';

ALTER TABLE admin_members
  ADD CONSTRAINT admin_members_role_check
  CHECK (role IN ('system_owner', 'admin'));
