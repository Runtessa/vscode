const UI_BUILTIN_DEPENDENCIES = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'tailwindcss',
  'postcss',
  'autoprefixer',
  '@tailwindcss/postcss',
  '@tailwindcss/vite',
]);

const isBareImport = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 && !trimmed.startsWith('.') && !trimmed.startsWith('/');
};

export const extractUiDependencies = (source: string) => {
  if (!source) return [] as string[];
  const results: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || !isBareImport(trimmed) || UI_BUILTIN_DEPENDENCIES.has(trimmed) || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    results.push(trimmed);
  };
  const expressions = [
    /^\s*import(?:\s+type)?[\s\S]*?\s+from\s*['"]([^'"]+)['"]\s*;?/gm,
    /^\s*import\s*['"]([^'"]+)['"]\s*;?/gm,
    /^\s*export(?:\s+type)?[\s\S]*?\s+from\s*['"]([^'"]+)['"]\s*;?/gm,
    /require\(\s*['"]([^'"]+)['"]\s*\)/gm,
    /import\(\s*['"]([^'"]+)['"]\s*\)/gm,
  ];
  for (const expression of expressions) {
    let match: RegExpExecArray | null;
    while ((match = expression.exec(source))) {
      add(match[1]);
    }
  }
  return results;
};
