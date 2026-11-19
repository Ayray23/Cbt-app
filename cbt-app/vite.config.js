import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function offlineShell() {
  let outputDirectory;
  return {
    name: "cbt-offline-shell",
    apply: "build",
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const assets = readdirSync(resolve(outputDirectory, "assets")).map(
        (name) => `/assets/${name}`,
      );
      const revision = createHash("sha256")
        .update(assets.join("|"))
        .digest("hex")
        .slice(0, 12);
      const template = readFileSync(resolve(outputDirectory, "sw.js"), "utf8");
      writeFileSync(
        resolve(outputDirectory, "sw.js"),
        template
          .replace("cbt-app-shell-v2", `cbt-app-shell-v2-${revision}`)
          .replace("/* CBT_ASSETS */ []", JSON.stringify(assets)),
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), offlineShell()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/jszip")) return "document-zip";
          if (id.includes("node_modules/mammoth")) return "document-import";
          if (id.includes("node_modules/@firebase/firestore"))
            return "firestore";
          if (id.includes("node_modules/@firebase/auth"))
            return "firebase-auth";
          if (
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react/")
          )
            return "react-runtime";
        },
      },
    },
  },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
