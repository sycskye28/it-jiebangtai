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
await app.register(multipart);
await registerAuth(app);
await app.register(registerRoutes);

app.setErrorHandler((error: any, _request, reply) => {
  const statusCode = error.statusCode ?? 500;
  reply.status(statusCode).send({
    error: statusCode >= 500 ? "Internal Server Error" : error.message,
    detail: config.nodeEnv === "development" ? error.message : undefined
  });
});

await app.listen({ port: config.port, host: "0.0.0.0" });
