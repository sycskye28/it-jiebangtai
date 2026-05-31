import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { feishuService } from "./feishu.js";
import { ensureDevUser, upsertFeishuLoginUser } from "./repositories.js";

export async function registerAuth(app: FastifyInstance) {
  app.addHook("preHandler", async (request) => {
    if (request.url.startsWith("/health")) return;
    if (request.url.startsWith("/api/feishu/callback")) return;
    request.user = await ensureDevUser(request.headers);
  });

  app.get("/api/auth/me", async (request) => {
    return request.user;
  });

  app.get("/api/auth/feishu/oauth-url", async (request) => {
    const query = z.object({ redirectUri: z.string().url().optional() }).parse(request.query);
    const redirectUri = query.redirectUri ?? process.env.FEISHU_WEB_REDIRECT_URI ?? "http://localhost:5173";
    const url = new URL("https://passport.feishu.cn/suite/passport/oauth/authorize");
    url.searchParams.set("client_id", process.env.FEISHU_APP_ID ?? "");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", `it-jiebangtai-${randomUUID()}`);
    return {
      configured: Boolean(process.env.FEISHU_APP_ID),
      redirectUri,
      url: url.toString()
    };
  });

  app.post("/api/auth/feishu/login", async (request) => {
    const body = z.object({ code: z.string().optional() }).parse(request.body ?? {});
    if (body.code) {
      const login = await feishuService.exchangeLoginCode(body.code);
      const user = await upsertFeishuLoginUser(login.userInfo);
      return {
        user,
        feishu: {
          expiresIn: login.expiresIn,
          scope: login.scope,
          userInfo: login.userInfo
        }
      };
    }

    return {
      user: request.user,
      mode: "development",
      note: "Pass { code } from Feishu miniapp/web login to exchange real user identity."
    };
  });
}

declare module "fastify" {
  interface FastifyRequest {
    user: import("./types.js").AuthUser;
  }
}
