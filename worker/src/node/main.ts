// Boot sequence for the container: database, env, HTTP server.
//
// Split from entry.ts so the whole boot path can be tested — entry.ts is only the bit
// that reads the real process and installs signal handlers, which a test cannot own.
import { startCronSchedules, type ScheduleFn } from "./cron";
import { buildNodeEnv, createLibsqlDatabase, resolvePort, type ProcessEnv } from "./nodeEnv";
import { startNodeServer } from "./nodeServer";

export interface RunningApp {
  port: number;
  shutdown(): Promise<void>;
}

export async function startApp(
  source: ProcessEnv,
  deps: { schedule?: ScheduleFn } = {}
): Promise<RunningApp> {
  const { db, close: closeDb } = createLibsqlDatabase(source);
  const env = buildNodeEnv(source, db);
  const port = resolvePort(source);

  let server;
  try {
    server = await startNodeServer({ env, port, hostname: source.HOST });
  } catch (e) {
    closeDb();
    throw e;
  }

  console.log(`cfl-feedback-worker listening on port ${server.port}`);

  // Run the schedules unless told not to. Off is what a second replica needs: with more
  // than one process scheduling, every daily ingest and every sweep would run twice.
  const cronEnabled = (source.CRON_ENABLED ?? "true").toLowerCase() !== "false";
  const schedules = cronEnabled ? startCronSchedules(env, deps) : null;
  console.log(cronEnabled ? "cron schedules started (UTC)" : "cron schedules disabled");

  let stopped = false;
  return {
    port: server.port,
    async shutdown() {
      // Idempotent: SIGTERM and SIGINT can both arrive, and Dokploy sends SIGTERM then
      // SIGKILL, so a second call must not throw on an already-closed server.
      if (stopped) return;
      stopped = true;
      schedules?.stop();
      await server.close();
      closeDb();
    },
  };
}
