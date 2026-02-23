import { defineConfig } from 'vite';

// Use /<repo>/ base on GitHub Actions; override locally with BASE_PATH if needed.
const base = process.env.BASE_PATH || (process.env.GITHUB_ACTIONS ? '/Heritage-Buildings/' : '/');

export default defineConfig({
  base,
});
