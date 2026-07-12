import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import {
  sealSession,
  sealMemberSession,
  isSessionValid,
  parseSession,
  memberPathAllowed,
  SESSION_COOKIE,
} from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-not-for-production";
});

describe("session", () => {
  it("has a port-scoped cookie name", () => {
    expect(SESSION_COOKIE).toMatch(/^aigloo_session_/);
  });

  it("a token sealed against a version validates against that same version", () => {
    const token = sealSession("v1");
    expect(isSessionValid(token, "v1")).toBe(true);
  });

  it("rejects when the current version no longer matches — the whole point of #3", () => {
    const token = sealSession("v1");
    expect(isSessionValid(token, "v2-after-password-change")).toBe(false);
  });

  it("admin token payload includes role + v + iat", () => {
    const token = sealSession("some-version-fingerprint");
    const [payload] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    expect(decoded.v).toBe("some-version-fingerprint");
    expect(decoded.role).toBe("admin");
    expect(typeof decoded.iat).toBe("number");
  });

  it("rejects a tampered signature", () => {
    const token = sealSession("v1");
    const [payload] = token.split(".");
    const tampered = `${payload}.${"0".repeat(64)}`;
    expect(isSessionValid(tampered, "v1")).toBe(false);
  });

  it("rejects a tampered payload (re-signing a modified version claim)", () => {
    const token = sealSession("v1");
    const forgedPayload = Buffer.from(JSON.stringify({ v: "v2", iat: Date.now() }), "utf8").toString("base64url");
    const [, sig] = token.split(".");
    expect(isSessionValid(`${forgedPayload}.${sig}`, "v2")).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(isSessionValid(undefined, "v1")).toBe(false);
    expect(isSessionValid("", "v1")).toBe(false);
    expect(isSessionValid("not-a-valid-token", "v1")).toBe(false);
    expect(isSessionValid("missing-dot-separator", "v1")).toBe(false);
  });

  it("rejects when there's no current version at all (admin disabled)", () => {
    const token = sealSession("v1");
    expect(isSessionValid(token, "")).toBe(false);
  });

  it("rejects an expired token (defense in depth beyond the cookie's own Max-Age)", () => {
    const oldPayload = Buffer.from(
      JSON.stringify({ role: "admin", v: "v1", iat: Date.now() - 31 * 24 * 60 * 60 * 1000 }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", process.env.SESSION_SECRET as string).update(oldPayload).digest("hex");
    expect(isSessionValid(`${oldPayload}.${sig}`, "v1")).toBe(false);
  });

  it("legacy admin tokens without role still validate", () => {
    const payload = Buffer.from(JSON.stringify({ v: "v1", iat: Date.now() }), "utf8").toString("base64url");
    const sig = createHmac("sha256", process.env.SESSION_SECRET as string).update(payload).digest("hex");
    expect(isSessionValid(`${payload}.${sig}`, "v1")).toBe(true);
  });
});

describe("member session", () => {
  it("seals and parses a member fingerprint", () => {
    const token = sealMemberSession("abcd1234");
    const s = parseSession(token, {
      currentAdminVersion: "admin-v",
      validFingerprints: ["abcd1234", "other"],
    });
    expect(s).toEqual({ role: "member", fingerprint: "abcd1234", iat: expect.any(Number) });
  });

  it("rejects member when fingerprint is no longer in config", () => {
    const token = sealMemberSession("abcd1234");
    expect(
      parseSession(token, {
        currentAdminVersion: "admin-v",
        validFingerprints: ["other-only"],
      }),
    ).toBeNull();
  });

  it("member tokens do not pass isSessionValid (admin-only helper)", () => {
    const token = sealMemberSession("abcd1234");
    expect(isSessionValid(token, "admin-v")).toBe(false);
  });
});

describe("memberPathAllowed", () => {
  it("allows usage, tools, and related APIs", () => {
    expect(memberPathAllowed("/usage")).toBe(true);
    expect(memberPathAllowed("/tools")).toBe(true);
    expect(memberPathAllowed("/tools/claude-code")).toBe(true);
    expect(memberPathAllowed("/api/me")).toBe(true);
    expect(memberPathAllowed("/api/cli-detect/claude-code")).toBe(true);
    expect(memberPathAllowed("/api/gw/admin/usage")).toBe(true);
    expect(memberPathAllowed("/api/gw/admin/usage/series")).toBe(true);
    expect(memberPathAllowed("/api/gw/admin/savings/summary")).toBe(true);
    expect(memberPathAllowed("/api/gw/admin/keys")).toBe(true);
  });

  it("denies admin surfaces", () => {
    expect(memberPathAllowed("/")).toBe(false);
    expect(memberPathAllowed("/providers")).toBe(false);
    expect(memberPathAllowed("/api/gw/admin/providers")).toBe(false);
    expect(memberPathAllowed("/config")).toBe(false);
  });
});
