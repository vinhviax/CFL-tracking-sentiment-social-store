// Container entrypoint. Everything testable lives in main.ts; this file is the process.
import { startApp } from "./main";

const app = await startApp(process.env);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    app.shutdown().then(
      () => process.exit(0),
      (e) => {
        console.error("shutdown failed", e);
        process.exit(1);
      }
    );
  });
}
