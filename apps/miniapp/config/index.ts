import { defineConfig } from "@tarojs/cli";

export default defineConfig({
  projectName: "it-jiebangtai-miniapp",
  date: "2026-05-30",
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: "src",
  outputRoot: "dist",
  framework: "react",
  compiler: "vite",
  mini: {},
  h5: {}
});
