import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `scripts/` son utilidades de Node (fetch, Buffer, process…), no código de la app.
  // `.claude/worktrees/` son copias del repo: lintarlas duplica cada error del árbol.
  // `design/` son assets promocionales (el spot), con código vendorizado y globals de navegador.
  { ignores: ['dist', 'scripts', '.claude', 'design'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);
