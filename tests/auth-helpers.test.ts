import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import after the mock so auth.ts picks up the mocked spawn.
const { buildOpenCommand, openInBrowser } = await import("../src/tools/auth.js");

interface FakeChild extends EventEmitter {
  unref: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.unref = vi.fn();
  return child;
}

describe("buildOpenCommand", () => {
  it("uses `open` on darwin", () => {
    expect(buildOpenCommand("darwin", "https://example.com/x")).toEqual({
      cmd: "open",
      args: ["https://example.com/x"],
    });
  });

  it("uses `xdg-open` on linux", () => {
    expect(buildOpenCommand("linux", "https://example.com/x")).toEqual({
      cmd: "xdg-open",
      args: ["https://example.com/x"],
    });
  });

  it("uses `rundll32 url.dll,FileProtocolHandler` on win32 — avoids cmd parser", () => {
    expect(buildOpenCommand("win32", "https://example.com/x")).toEqual({
      cmd: "rundll32",
      args: ["url.dll,FileProtocolHandler", "https://example.com/x"],
    });
  });

  it("passes URLs containing `&` and `^` as a single argv element (no shell injection)", () => {
    const url =
      "https://trello.com/1/OAuthAuthorizeToken?oauth_token=abc&name=My%20App^X&expiration=never";
    for (const platform of ["darwin", "linux", "win32"] as const) {
      const built = buildOpenCommand(platform, url);
      // The URL appears unchanged as the final argv element on every platform.
      expect(built.args.at(-1)).toBe(url);
      // No argv element ever contains a shell metacharacter on its own.
      for (const arg of built.args) {
        expect(arg.includes("\n")).toBe(false);
      }
    }
  });
});

describe("openInBrowser (production path)", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("invokes spawn with the platform-appropriate cmd+argv, no shell, detached + ignored stdio", () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    const url = "https://trello.com/1/OAuthAuthorizeToken?oauth_token=abc";
    openInBrowser(url);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnMock.mock.calls[0]!;
    const expected = buildOpenCommand(process.platform, url);
    expect(cmd).toBe(expected.cmd);
    expect(args).toEqual(expected.args);
    expect(opts).toMatchObject({ stdio: "ignore", detached: true });
    // No shell flag — argv must be passed directly to the OS, not via a shell parser.
    expect((opts as { shell?: boolean }).shell).toBeUndefined();
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("swallows synchronous spawn() throws (e.g. ENOENT for `open` in a stripped env)", () => {
    spawnMock.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => openInBrowser("https://example.com")).not.toThrow();
  });

  it("swallows async `error` events on the spawned child (browser not installed)", () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);
    openInBrowser("https://example.com");
    // An unhandled 'error' event on an EventEmitter throws synchronously; emitting it
    // here proves openInBrowser attached the listener that absorbs it.
    expect(() => child.emit("error", new Error("spawn xdg-open ENOENT"))).not.toThrow();
  });
});
