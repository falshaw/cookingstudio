// Generic Prisma stand-in for unit tests: every model/method exists and returns a neutral default
// (findMany → [], findUnique/findFirst → null, count → 0, create/update/upsert → the data with an id)
// unless the test overrides it: makePrisma({ user: { findMany: async () => [...] } }).
import { vi } from "vitest";

type Fn = (...args: never[]) => unknown;
export type Overrides = Record<string, Record<string, Fn> | Fn>;

let seq = 0;
export const cuid = () => `cfake${String(++seq).padStart(20, "0")}`;

function defaultFor(method: string) {
  switch (method) {
    case "findMany":
    case "groupBy":
      return async () => [];
    case "findUnique":
    case "findFirst":
      return async () => null;
    case "findUniqueOrThrow":
    case "findFirstOrThrow":
      return async () => {
        throw new Error("not found");
      };
    case "count":
      return async () => 0;
    case "create":
    case "update":
    case "upsert":
      return async (args: { data?: Record<string, unknown>; create?: Record<string, unknown> }) => ({ id: cuid(), ...(args?.data ?? args?.create ?? {}) });
    case "createMany":
    case "updateMany":
    case "deleteMany":
      return async () => ({ count: 0 });
    case "delete":
      return async () => ({});
    default:
      return async () => null;
  }
}

export function makePrisma(overrides: Overrides = {}) {
  const calls: { model: string; method: string; args: unknown }[] = [];
  const client: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, model: string) {
        if (model === "then") return undefined;
        const top = overrides[model];
        if (model.startsWith("$")) {
          if (typeof top === "function") return vi.fn(top);
          if (model === "$transaction") return vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (c: unknown) => unknown)(client) : Promise.all(arg as Promise<unknown>[])));
          return vi.fn(async () => 0);
        }
        return new Proxy(
          {},
          {
            get(_t2, method: string) {
              const o = (top as Record<string, Fn> | undefined)?.[method];
              const impl = o ?? defaultFor(method);
              return (args: unknown) => {
                calls.push({ model, method, args });
                return (impl as (a: unknown) => unknown)(args);
              };
            },
          },
        );
      },
    },
  );
  return { client, calls };
}
