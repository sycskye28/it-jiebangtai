import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

const webOrigins = [
  process.env.WEB_ORIGINS,
  process.env.WEB_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]
  .filter(Boolean)
  .flatMap((origin) => origin!.split(","))
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.API_PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  webOrigins: [...new Set(webOrigins)],
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(__dirname, "../../../uploads"),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://it_user:it_password@localhost:5432/it_management",
  defaultAdminName: process.env.DEFAULT_ADMIN_NAME ?? "彭涛",
  defaultAdminUserId: process.env.DEFAULT_ADMIN_USER_ID ?? "",
  feishu: {
    appId: process.env.FEISHU_APP_ID ?? "",
    appSecret: process.env.FEISHU_APP_SECRET ?? "",
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN ?? "",
    encryptKey: process.env.FEISHU_ENCRYPT_KEY ?? "",
    webRedirectUri: process.env.FEISHU_WEB_REDIRECT_URI ?? "http://localhost:5173",
    bitableAppToken: process.env.FEISHU_BITABLE_APP_TOKEN ?? "",
    bitableWebUrl: process.env.FEISHU_BITABLE_WEB_URL ?? "",
    demandTableId: process.env.FEISHU_DEMAND_TABLE_ID ?? "",
    issueTableId: process.env.FEISHU_ISSUE_TABLE_ID ?? "",
    innovationTableId: process.env.FEISHU_INNOVATION_TABLE_ID ?? "",
    innovationNotifyUserIds: (process.env.FEISHU_INNOVATION_NOTIFY_USER_IDS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    systemOwnerTableId: process.env.FEISHU_SYSTEM_OWNER_TABLE_ID ?? "",
    requireRealApi: process.env.FEISHU_REQUIRE_REAL_API === "true",
    messageReceiveIdType: process.env.FEISHU_MESSAGE_RECEIVE_ID_TYPE ?? "user_id",
    notificationsDisabled: process.env.FEISHU_NOTIFICATIONS_DISABLED === "true"
  }
};
