// Serves the same Hono app over plain Node HTTP.
//
// The app itself is untouched: `src/index.ts` still exports the Workers default handler
// so the Cloudflare deployment keeps running while this side is built. All that changes
// here is who calls `app.fetch` and what it is handed as `env` and `executionCtx`.
import { serve } from "@hono/node-server";
import { app } from "../index";
import type { Env } from "../types";

/**
 * Stand-in for Workers' ExecutionContext.
 *
 * Five routes hand their queue drain to `c.executionCtx.waitUntil(...)`, and Hono throws
 * "This context has no ExecutionContext" if nothing supplies one — so this shim is what
 * keeps those routes from 500ing under Node.
 *
 * The whole point of waitUntil on Workers was to keep a task alive after the response,
 * because the isolate is torn down otherwise. A container has no such teardown: the
 * promise simply keeps running. So the only thing left to do is catch the rejection —
 * an unhandled one takes the entire process down under Node, whereas on Workers it only
 * spoiled that one invocation. Every route already logs its own failures; this is the
 * backstop for the ones that do not.
 */
export function createNodeExecutionContext(): ExecutionContext {
  return {
    waitUntil(promise: Promise<unknown>) {
      void Promise.resolve(promise).catch((e) => console.error("background task failed", e));
    },
    passThroughOnException() {
      // Workers-only: it asks the edge to fall back to origin on an exception. Nothing
      // to fall back to here, so this is a no-op rather than an error.
    },
  } as unknown as ExecutionContext;
}

/**
 * A fetch handler bound to one env, the way Workers bound one per deployment.
 *
 * @hono/node-server would otherwise pass `{ incoming, outgoing }` as `env`, which would
 * make `c.env.DB` undefined in all 133 database call sites.
 */
export function createNodeFetchHandler(env: Env) {
  return (request: Request) => app.fetch(request, env, createNodeExecutionContext());
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/**
 * Start listening. Port 0 lets the OS pick, which is how the test avoids a fixed port.
 */
export function startNodeServer(options: {
  env: Env;
  port: number;
  hostname?: string;
}): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: createNodeFetchHandler(options.env),
        port: options.port,
        hostname: options.hostname,
      },
      (info) => {
        resolve({
          port: info.port,
          close: () =>
            new Promise<void>((done, fail) =>
              server.close((e) => (e ? fail(e) : done()))
            ),
        });
      }
    );
    server.on("error", reject);
  });
}
