import { defineConfig } from 'vite';

// Todo por defecto salvo el puerto: lo fija el entorno (PORT) para poder levantar el
// dev server aunque otro ya tenga tomado el 5173.
export default defineConfig({
  server: { port: Number(process.env.PORT) || 5173 },
});
