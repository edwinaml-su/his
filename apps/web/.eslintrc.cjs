module.exports = {
  root: true,
  extends: ["@his/eslint-config/next"],
  // Next 16 elimina el comando `next lint`; el linter se invoca ahora con el
  // CLI de ESLint (`eslint src --ext .ts,.tsx`). Ese comando NO le pasa al
  // plugin la ubicación del proyecto Next, y sin ella `no-html-link-for-pages`
  // no resuelve las rutas del App Router y marca falsos positivos. `rootDir`
  // se lo dice explícitamente — paso documentado para monorepos.
  settings: {
    next: { rootDir: __dirname },
  },
};
