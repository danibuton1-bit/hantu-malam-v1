import { afterEach, describe, expect, it } from "vitest";
import { applyMap, liftAt, MAPS, move, ROOMS } from "./game";

afterEach(() => applyMap("rumah"));
describe("maps", () => {
  it("offers exactly 4 maps", () => { expect(MAPS.map((m) => m.id)).toEqual(["rumah", "rumahsakit", "kuburan", "hotel"]); });
  it("hotel floors are separated: walking through the old doorway is blocked", () => {
    applyMap("hotel");
    expect(move(750, 470, 0, 60).y).toBeLessThan(500);
    applyMap("rumah");
    expect(move(750, 470, 0, 60).y).toBeGreaterThan(500);
  });
  it("hotel lift pads exist only on the hotel map", () => {
    applyMap("hotel"); expect(liftAt(750, 410)?.floor).toBe(1); expect(liftAt(750, 590)?.floor).toBe(2);
    expect(ROOMS[0]!.name).toContain("Lt.1");
    applyMap("rumah"); expect(liftAt(750, 410)).toBeNull();
  });
});
