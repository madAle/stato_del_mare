import { describe, expect, it } from "vitest";
import { CacheFrame } from "../src/data/cache";

const frame = (n: number) => new Int16Array(n);

describe("cache a byte", () => {
  it("conta i byte e non i frame", () => {
    const c = new CacheFrame(1000);
    c.metti("a", frame(100));   // 200 byte
    c.metti("b", frame(300));   // 600 byte
    expect(c.byteUsati).toBe(800);
    expect(c.quanti).toBe(2);
  });

  it("sfratta il meno recente quando sfora il budget", () => {
    const c = new CacheFrame(1000);
    c.metti("a", frame(200));   // 400
    c.metti("b", frame(200));   // 800
    c.prendi("a");              // "a" torna il piu' recente
    c.metti("c", frame(200));   // 1200 > 1000, sfratta "b"
    expect(c.prendi("b")).toBeUndefined();
    expect(c.prendi("a")).toBeDefined();
    expect(c.prendi("c")).toBeDefined();
  });

  it("un frame piu' grande del budget non svuota la cache per poi non entrarci", () => {
    const c = new CacheFrame(1000);
    c.metti("a", frame(200));
    c.metti("gigante", frame(5000));
    expect(c.prendi("gigante")).toBeUndefined();
    expect(c.prendi("a")).toBeDefined();
  });
});
