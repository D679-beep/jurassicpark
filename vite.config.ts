import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  // Use the port a launcher assigns via PORT (e.g. when 5173 is taken); Vite's default otherwise.
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
