import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/lib/prisma.ts', 'src/lib/redis.ts'],
    },
  },
});
