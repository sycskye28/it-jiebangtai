import type { FastifyRequest } from "fastify";
import type { RoleKey } from "@it/shared";

export type AuthUser = {
  id: string;
  feishuUserId: string;
  name: string;
  department: string | null;
  role: RoleKey;
  accessStatus: "active" | "pending" | "rejected";
};

export type AuthedRequest = FastifyRequest & {
  user: AuthUser;
};
