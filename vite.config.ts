import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["es"],
      fileName: "audio-codex",
      cssFileName: "audio-codex",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**", "src/foundry/sidebar-art.test.ts", "src/foundry/sidebar-channel.test.ts"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["src/foundry/sidebar-art.test.ts", "src/foundry/sidebar-channel.test.ts"],
        },
      },
    ],
  },
});
