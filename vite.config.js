import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tideDpopPlugin } from "@tidecloak/js/vite";

// Backend của người B. Đổi bằng API_TARGET nếu B chạy cổng khác.
const apiTarget = process.env.API_TARGET ?? "http://localhost:8787";
const src = (p) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig(({ mode }) => {
  // `npm run preview:ui` — xem 4 tab trên localhost mà không cần Tide thật (chờ finalize.sh).
  // Đổi cả 4 chỗ dùng Tide thật sang bản giả trong bộ nhớ. KHÔNG dùng để demo thật.
  const preview = mode === "preview-ui";

  return {
    plugins: [react(), tideDpopPlugin()],
    resolve: preview
      ? {
          alias: {
            "@tidecloak/react": src("lib/mock/tidecloak-react.jsx"),
            "@tidecloak/js": src("lib/mock/tidecloak-js.js"),
            "./lib/api.js": src("lib/api.preview.js"),
            "./lib/relationship.js": src("lib/relationship.preview.js"),
          },
        }
      : undefined,
    server: {
      host: "localhost",
      port: preview ? 5138 : 5137,
      strictPort: true,
      proxy: preview ? undefined : { "/api": { target: apiTarget, changeOrigin: false } },
    },
  };
});
