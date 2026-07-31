export const DEFAULT_IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.venv/**",
  "**/__pycache__/**",
  "**/dist/**",
  "**/build/**",
  "**/.pi/**",
];

export const DEFAULT_IGNORE_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".pi",
]);
