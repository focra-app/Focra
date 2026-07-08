import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    worker: {
      format: 'es',
      rollupOptions: {
        output: {
          format: 'es',
          inlineDynamicImports: true
        }
      }
    },
    optimizeDeps: {
      exclude: ['@xenova/transformers']
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        'fs': resolve('src/renderer/lib/vite-stubs/empty-node-module.ts'),
        'path': resolve('src/renderer/lib/vite-stubs/empty-node-module.ts'),
        'url': resolve('src/renderer/lib/vite-stubs/empty-node-module.ts'),
        'onnxruntime-node': resolve('src/renderer/lib/vite-stubs/onnxruntime-node-stub.ts')
      }
    },
    plugins: [react()]
  }
})
