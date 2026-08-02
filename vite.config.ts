import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage } from "node:http";

// FEATURE-042: `/projects/:projectId/cases` es simultáneamente una ruta de página (React Router,
// sección C.2) y un endpoint de API (sección B.7) -- el mismo prefijo sirve para las dos cosas a
// propósito, igual que ya definía el diseño aprobado. Solo en dev, con front y back en el mismo
// origen, hace falta distinguir "navegación de página" ("Accept: text/html", el browser pidiendo
// el documento) de "fetch a la API" (nuestro cliente nunca pide text/html) -- en producción esto
// no aplica: Vercel y el VPS son orígenes distintos, no hay colisión posible.
const projectsProxy: ProxyOptions = {
  target: "http://127.0.0.1:3000",
  bypass: (req: IncomingMessage) => {
    const accept = req.headers.accept ?? "";
    if (accept.includes("text/html")) return req.url; // deja que Vite sirva la SPA
    return undefined; // proxea al backend
  },
};

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    proxy: {
      "/runs": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
      "/auth": "http://127.0.0.1:3000",
      "/intake": "http://127.0.0.1:3000",
      "/projects": projectsProxy,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
