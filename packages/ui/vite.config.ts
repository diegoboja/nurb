import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import dts from "vite-plugin-dts"

export default defineConfig({
  plugins: [react(), dts({ include: ["src"], exclude: ["src/**/*.test.*", "src/test-setup.ts"] })],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      // three/addons/* must stay external too, or rollup inlines OrbitControls into the bundle.
      external: (id) => /^(react|react-dom|react\/jsx-runtime|three|clsx|react-markdown)($|\/)/.test(id),
    },
  },
})
