import { Server } from "node:http";

export interface ShutdownOptions {
  server: Server;
  disconnect: () => Promise<unknown>;
  timeoutMs: number;
  write?: (event: Record<string, unknown>) => void;
}

const defaultWrite = (event: Record<string, unknown>) => console.log(JSON.stringify(event));

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  const outcome = await Promise.race([
    promise.then((value) => ({ value }), (error: unknown) => ({ error })),
    timeout,
  ]);
  if (timer) clearTimeout(timer);
  return outcome;
};

/** Create one idempotent, bounded shutdown sequence for a listening HTTP server. */
export const createGracefulShutdown = ({
  server,
  disconnect,
  timeoutMs,
  write = defaultWrite,
}: ShutdownOptions) => {
  let shutdownPromise: Promise<boolean> | undefined;

  return (signal = "manual"): Promise<boolean> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      write({ event: "shutdown_started", signal });
      let successful = true;

      const closeResult = await withTimeout(new Promise<Error | null>((resolve) => {
        server.close((error) => resolve(error ?? null));
        server.closeIdleConnections?.();
      }), timeoutMs);
      if (closeResult === undefined) {
        successful = false;
        server.closeAllConnections();
        write({ event: "shutdown_timeout", resource: "http_server" });
      } else if ("error" in closeResult) {
        const error = closeResult.error;
        successful = false;
        write({ event: "shutdown_error", resource: "http_server", error: error instanceof Error ? error.name : "UnknownError" });
      }

      const disconnectPromise = Promise.resolve().then(disconnect);
      const disconnectResult = await withTimeout(disconnectPromise, timeoutMs);
      if (disconnectResult === undefined) {
        successful = false;
        write({ event: "shutdown_timeout", resource: "database" });
      } else if ("error" in disconnectResult) {
        successful = false;
        const error = disconnectResult.error;
        write({
          event: "shutdown_error",
          resource: "database",
          error: error instanceof Error ? error.name : "UnknownError",
        });
      }

      write({ event: "shutdown_complete", successful });
      return successful;
    })().catch((error: unknown) => {
      write({ event: "shutdown_error", resource: "unknown", error: error instanceof Error ? error.name : "UnknownError" });
      return false;
    });
    return shutdownPromise;
  };
};
