import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tideDpopPlugin } from "@tidecloak/js/vite";

// Backend của người B. Đổi bằng API_TARGET nếu B chạy cổng khác.
const apiTarget = process.env.API_TARGET ?? "http://localhost:8787";

export default defineConfig({
  // tideDpopPlugin phục vụ /tide_dpop/... cho enclave. Không truyền config vì
  // public/tidecloak.json do A sinh ra và nằm ngoài git.
  plugins: [react(), tideDpopPlugin()],
  server: {
    host: "localhost",
    port: 5137,
    strictPort: true,
    proxy: { "/api": { target: apiTarget, changeOrigin: false } },
  },
});
