import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The two edges the dependency graph forbids, held by a test rather than by care.
 *
 * The first: one module owns the client, and nothing but `env.ts` reads the process
 * environment. A second client anywhere is a second set of defaults, a second place a
 * base URL can be wrong, and the day a provider is switched on it is the one that
 * quietly still points at the double.
 *
 * The second: the mock can open no connection. A test double that can reach the network
 * can spend money and can hide a missing fixture behind a real answer, which is the
 * failure this whole slice exists to make impossible.
 */

const api = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceOf = (file: string) => readFileSync(file, "utf8");

const everySourceFile = async (): Promise<string[]> => {
  const found: string[] = [];
  for await (const file of glob("src/**/*.ts", { cwd: api })) found.push(join(api, file));
  return found;
};

describe("the one client", () => {
  it("is constructed in lib/ai and nowhere else", async () => {
    const importers = (await everySourceFile()).filter((file) =>
      /from\s+"openai(\/[^"]*)?"/.test(sourceOf(file)),
    );

    expect(importers.map((file) => file.slice(api.length + 1).replaceAll("\\", "/"))).toEqual([
      "src/lib/ai/client.ts",
    ]);
  });

  it("leaves env.ts the one reader of the process environment", async () => {
    const readers = (await everySourceFile()).filter((file) => /process\.env/.test(sourceOf(file)));

    expect(readers.map((file) => file.slice(api.length + 1).replaceAll("\\", "/"))).toEqual([
      "src/env.ts",
    ]);
  });
});

/**
 * The mock's import graph, walked from its entry point through its own relative
 * imports. Nothing it reaches may name a client, a transport or a socket: if the
 * closure holds none of them, no line of the mock can call out, whatever it is asked
 * for and from whichever environment it runs.
 */
describe("the mock's import graph", () => {
  const canOpenAConnection = [
    "openai",
    "axios",
    "undici",
    "node-fetch",
    "node:http",
    "node:https",
    "node:net",
    "node:tls",
    "node:dgram",
    "http",
    "https",
    "net",
  ];

  const closureOf = (entry: string, seen = new Set<string>()): Set<string> => {
    const resolved = ["", ".ts", "/index.ts"]
      .map((suffix) => `${entry}${suffix}`)
      .find((candidate) => {
        try {
          readFileSync(candidate);
          return true;
        } catch {
          return false;
        }
      });
    if (resolved === undefined || seen.has(resolved)) return seen;
    seen.add(resolved);
    for (const [, specifier] of sourceOf(resolved).matchAll(/from\s+"([^"]+)"/g)) {
      if (specifier?.startsWith(".") === true) {
        closureOf(resolve(dirname(resolved), specifier), seen);
      } else if (specifier !== undefined) {
        seen.add(specifier);
      }
    }
    return seen;
  };

  it("reaches nothing that can open a connection", () => {
    const closure = closureOf(join(api, "src/lib/ai/mock/index.ts"));

    expect([...closure].filter((name) => canOpenAConnection.includes(name))).toEqual([]);
  });

  it("does not call fetch", () => {
    const closure = [...closureOf(join(api, "src/lib/ai/mock/index.ts"))].filter((name) =>
      name.endsWith(".ts"),
    );

    expect(closure.filter((file) => /\bfetch\s*\(/.test(sourceOf(file)))).toEqual([]);
  });
});
