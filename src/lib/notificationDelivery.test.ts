import { describe, expect, test } from "bun:test";
import { notificationDelivered } from "./notificationDelivery";

describe("notification delivery acknowledgement", () => {
  test("does not acknowledge when every channel failed", () => {
    expect(notificationDelivered(false, false)).toBe(false);
  });

  test("acknowledges a successful push delivery", () => {
    expect(notificationDelivered(true, false)).toBe(true);
  });

  test("acknowledges a successful email delivery", () => {
    expect(notificationDelivered(false, true)).toBe(true);
  });

  test("acknowledges when both channels delivered", () => {
    expect(notificationDelivered(true, true)).toBe(true);
  });
});
