// Starts the background worker (LLM jobs + ComfyUI image queue) once per server process.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("./lib/worker");
    startWorker();
  }
}
