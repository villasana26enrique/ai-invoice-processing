import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// "server-only" throws when imported outside Next's server build; in tests it is just a marker
vi.mock("server-only", () => ({}));

afterEach(() => {
  if (typeof document !== "undefined") cleanup();
});
