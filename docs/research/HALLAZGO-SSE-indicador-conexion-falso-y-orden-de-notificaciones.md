# Hallazgo — Indicador de conexión SSE falso y posible orden incorrecto de notificaciones

Fecha: 2026-08-17
Origen: reportado en vivo durante la validación E2E de la rama
`fix/testing-policy-persistence-y-reescalacion-roadmap` — el usuario tuvo que salir y volver a
entrar a la vista de un caso para que apareciera el banner de "Escalamiento abierto", pese a que el
panel de Conexión mostraba "SSE activo" todo el tiempo.

No forma parte de esa rama ni de ningún fix ya implementado — queda documentado acá para no
perderse hasta que se aborde.

## Hallazgo 1 (confirmado, trivial de corregir): el indicador de conexión miente

`web/src/runs/RunDetailPage.tsx:681-691`, componente `ConnectionPanel`:

```tsx
function ConnectionPanel({ runId }: { runId: string }) {
  return (
    ...
      <Radio className="h-4 w-4 text-emerald-600" />
      {runId ? "SSE activo" : "Sin run seleccionado"}
    ...
  );
}
```

No lee `EventSource.readyState` ni ningún estado real de la conexión — muestra "SSE activo" siempre
que haya un `runId`, sin importar si la conexión está realmente abierta, conectando, o caída. El
usuario no puede confiar en este indicador para diagnosticar si el stream sigue vivo.

**Fix propuesto**: pasar el `readyState` real desde `useRunStream` (o un estado derivado de sus
eventos `onopen`/`onerror`) hasta `ConnectionPanel`, y reflejar al menos 3 estados visualmente
distintos (conectando / activo / caído-reintentando).

## Hallazgo 2 (candidato a causa raíz, no confirmado con reproducción instrumentada)

`src/server/sse.ts:89-91`:

```ts
client.on("notification", (message) => {
  void handleNotification(message.payload);
});
```

Cada notificación de Postgres (`LISTEN/NOTIFY`, canal `run_events_channel`) dispara
`handleNotification` sin awaitearla ni serializarla por `runId`. Cuando se abre un escalamiento se
emiten al menos dos notificaciones casi seguidas:

1. Al insertar el `run_event` (`escalation_gate_recognized`/`escalation_opened`) — en ese momento
   `runs.status` puede seguir siendo `"running"` todavía, porque el update a `"escalated"`
   (`finalizeRun`, `src/db/repository.ts:1425`) ocurre después, en una llamada separada.
2. Al actualizar `runs.status = 'escalated'` — dispara el segundo trigger
   (`runs_notify_observer`, `migrations/0006_run_events_notify.sql`).

Como ambos `handleNotification` corren de forma concurrente sin ningún orden garantizado entre sí,
existe una ventana teórica donde la consulta de la primera notificación (más lenta, con
`runs.status` todavía `"running"` en el momento en que se ejecutó la query) se resuelve y escribe al
stream SSE *después* que la segunda (ya correcta) — dejando el último mensaje que ve el cliente
desactualizado.

El frontend en sí debería estar protegido de esto porque descarta el payload del evento SSE y
siempre revalida con un `GET /runs/:id` fresco al recibirlo
(`useRunStream` → `refresh` → `queryClient.invalidateQueries`, `RunDetailPage.tsx:196-208`) — pero
si React Query deduplica una invalidación mientras otro fetch para la misma `queryKey` sigue en
vuelo (comportamiento por defecto en ciertas versiones/configuraciones), ese refetch final puede
no dispararse, dejando la UI mostrando el estado previo al escalamiento hasta la próxima interacción
manual (como el "salir y volver a entrar" que reportó el usuario).

**Fix propuesto** (dos partes independientes, ninguna implementada todavía):
1. Serializar `handleNotification` por `runId` (cola simple o flag "hay una notificación pendiente,
   reprocesar al terminar la actual en curso") para garantizar que el snapshot final que recibe cada
   cliente sea siempre el más reciente, sin importar el orden de resolución de las queries
   concurrentes.
2. Revisar la configuración de React Query en el cliente (`web/src/lib/queryClient.ts`) para
   confirmar si `invalidateQueries` puede perderse por deduplicación mientras hay un fetch en
   vuelo, y si hace falta forzar `refetchType: "all"` o similar en este caso puntual.

## Estado

No confirmado con logs instrumentados en vivo — es un candidato razonado a partir de la lectura del
código, no una reproducción determinística. Antes de implementar el fix 2, conviene instrumentar
`handleNotification` con timestamps de inicio/fin por notificación para confirmar que el
solapamiento realmente ocurre en la práctica (la ventana de carrera depende de latencias de red/DB
que pueden ser demasiado pequeñas para manifestarse siempre).
