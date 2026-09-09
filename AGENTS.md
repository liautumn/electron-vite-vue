# Repository Instructions

## Type Ownership

- Export the actual API objects from `electron/preload/mod` and derive `Window` types from them in `src/vite-env.d.ts` using `typeof import(...)`.
- Keep request, response, and event types alongside the corresponding preload module; reuse them across processes with `import type`.
- Explicitly type IPC return values in preload methods because `ipcRenderer.invoke` returns `Promise<any>`.
- Derive API and session types from their implementations instead of maintaining duplicate method interfaces.
- Keep `src/types` only for types used exclusively inside the renderer application.
