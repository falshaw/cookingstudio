// Structured JSON logging (one line per event → `docker logs kitchen-app`). The proxy stamps every
// request with x-request-id; route handlers pass it in so a log line can be matched to its request.
// Never log health values, passwords or tokens — ids and counts only.
type Level = "debug" | "info" | "warn" | "error";
export type LogCtx = Record<string, unknown> & { requestId?: string | null; err?: unknown };

function errInfo(err: unknown) {
  if (err instanceof Error) return { error: err.message, errorName: err.name };
  return err === undefined ? {} : { error: String(err) };
}

export function log(level: Level, msg: string, ctx: LogCtx = {}): void {
  const { err, ...rest } = ctx;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, app: "cookingstudio", msg, ...rest, ...errInfo(err) });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const logInfo = (msg: string, ctx?: LogCtx) => log("info", msg, ctx);
export const logWarn = (msg: string, ctx?: LogCtx) => log("warn", msg, ctx);
export const logError = (msg: string, ctx?: LogCtx) => log("error", msg, ctx);

/** The proxy's x-request-id for a route handler's request. */
export function requestIdOf(req: Request): string | null {
  return req.headers.get("x-request-id");
}
