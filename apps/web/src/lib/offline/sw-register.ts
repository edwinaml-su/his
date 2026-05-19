/**
 * Registro del Service Worker bedside.
 *
 * Llama a esta función una sola vez en el componente raíz del layout bedside
 * (useEffect en client component). No modifica app-shell.tsx ni _app.ts.
 *
 * También registra el Background Sync tag "bedside-sync" para replay automático.
 */

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });

    // Solicita update inmediato si hay una nueva versión disponible
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    // Registrar Background Sync si está soportado
    if ("sync" in registration) {
      try {
        await (registration as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register("bedside-sync");
      } catch {
        // Background Sync no disponible en este contexto (ej. iOS Safari)
      }
    }
  } catch (err) {
    console.error("[SW] Registration failed:", err);
  }
}
