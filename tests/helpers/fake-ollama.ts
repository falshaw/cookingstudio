// A tiny local HTTP server that speaks enough of the Ollama API for the real ollama.ts client:
// /api/tags, /api/generate and /api/chat streamed as NDJSON. Answers come from a queue.
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeOllama {
  url: string;
  requests: { path: string; body: Record<string, unknown> }[];
  queue: (string | { error: string } | { status: number })[];
  close: () => Promise<void>;
}

export async function startFakeOllama(): Promise<FakeOllama> {
  const state: FakeOllama = { url: "", requests: [], queue: [], close: async () => {} };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ models: [{ name: "gemma4:12b" }] }));
      }
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      state.requests.push({ path: req.url ?? "", body: parsed });
      if (parsed.keep_alive === 0) {
        res.writeHead(200);
        return res.end("{}");
      }
      const next = state.queue.shift() ?? "";
      if (typeof next === "object" && "status" in next) {
        res.writeHead(next.status);
        return res.end("model not found");
      }
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      if (typeof next === "object" && "error" in next) {
        res.end(JSON.stringify({ error: next.error }) + "\n");
        return;
      }
      const key = req.url === "/api/chat" ? "message" : "response";
      // stream in small pieces, like the real server
      for (let i = 0; i < next.length; i += 40) {
        const piece = next.slice(i, i + 40);
        res.write(JSON.stringify(key === "message" ? { message: { content: piece } } : { response: piece }) + "\n");
      }
      res.end(JSON.stringify({ done: true }) + "\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise((r) => server.close(() => r()));
  return state;
}
