import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/types/evaluation.ts',
        'src/services/csvExport.ts',
        'src/services/evaluationBridge.ts',
        'src/services/ruleValidation.ts',
        'src/services/topologyHealingService.ts',
        'src/domain/scene-serializer/**/*.ts',
      ],
    },
  },
})
