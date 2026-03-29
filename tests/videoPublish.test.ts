import { describe, expect, it } from "vitest";
import { isVideoPublishRequest } from "../src/application/models/VideoPublish";

describe("isVideoPublishRequest", () => {
  it("returns true for valid payload", () => {
    const payload = {
      requestId: "req-1",
      userId: "user-1",
      title: "Video title",
      videoUrl: "https://example.com/video.mp4",
      platforms: ["youtube"],
      createdAt: new Date().toISOString(),
    };

    expect(isVideoPublishRequest(payload)).toBe(true);
  });

  it("returns false for missing required fields", () => {
    const payload = {
      userId: "user-1",
      title: "Video title",
      platforms: ["youtube"],
    };

    expect(isVideoPublishRequest(payload)).toBe(false);
  });
});
