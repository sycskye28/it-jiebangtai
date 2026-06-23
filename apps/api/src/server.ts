import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";
import { config } from "./config.js";
import { registerAuth } from "./auth.js";
import { registerRoutes } from "./routes.js";

const app = Fastify({
  logger: {
    level: config.nodeEnv === "development" ? "info" : "warn"
  }
});

await app.register(cors, {
  origin: config.webOrigins,
  credentials: true
});
await app.register(sensible);
await app.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});
await registerAuth(app);
await app.register(registerRoutes);

app.setErrorHandler((error: any, _request, reply) => {
  const statusCode = error.statusCode ?? 500;
  const message = statusCode === 413 || error.code === "FST_REQ_FILE_TOO_LARGE"
    ? "上传文件过大，请压缩到 20MB 以内后再上传。"
    : error.message;
  reply.status(statusCode).send({
    error: statusCode >= 500 ? "Internal Server Error" : message,
    detail: config.nodeEnv === "development" ? message : undefined
  });
});

await app.listen({ port: config.port, host: "0.0.0.0" });
