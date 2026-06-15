import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const feishuRemoteDebugScript = "<script src='https://lf-package-cn.feishucdn.com/obj/feishu-static/op/fe/devtools_frontend/remote-debug-0.0.1-alpha.6.js'></script>";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../../", ["VITE_", "WEB_"]);
  return {
    plugins: [
      react(),
      {
        name: "feishu-remote-debug-html",
        transformIndexHtml(html) {
          return html.replace(
            "<!-- FEISHU_REMOTE_DEBUG_SCRIPT -->",
            env.VITE_FEISHU_REMOTE_DEBUG === "true" ? feishuRemoteDebugScript : ""
          );
        }
      }
    ],
    server: {
      port: Number(env.WEB_PORT ?? process.env.WEB_PORT ?? 5173)
    }
  };
});
