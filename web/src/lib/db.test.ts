import { types } from "pg";
import { describe, expect, it } from "vitest";
import "./db";

// Ids are bigint. Without a parser pg returns them as strings, and the TypeScript types (id: number) would lie
describe("database types", () => {
  it("reads bigint ids as numbers", () => {
    expect(types.getTypeParser(types.builtins.INT8)("420")).toBe(420);
  });

  it("keeps amounts (numeric) as text, so no cent is lost to floating point", () => {
    expect(types.getTypeParser(types.builtins.NUMERIC)("1234.10")).toBe("1234.10");
  });
});
