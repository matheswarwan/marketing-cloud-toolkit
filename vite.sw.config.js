import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// The service worker, one ES module file: dist/background.js.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./src/background/index.js', import.meta.url)),
      formats: ['es'],
      fileName: () => 'background.js',
    },
  },
})
