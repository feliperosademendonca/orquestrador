import { describe, expect, it } from "vitest";
import type { Platform, VideoPublishRequest } from "../src/application/models/VideoPublish";
import { PublicacaoService } from "../src/application/services/PublicacaoService";
import type { IVideoPlatformAdapter } from "../src/application/interfaces/IVideoPlatformAdapter";
import { GeminiAdapter } from "../src/infrastructure/external/GeminiAdapter";

type AdapterResult = {
  platform: Platform;
  status: "success" | "failed";
  message?: string;
};

class FakeAdapter implements IVideoPlatformAdapter {
  constructor(
    public readonly platform: Platform,
    private readonly result: AdapterResult | Error
  ) {}

  async publish(): Promise<AdapterResult> {
    if (this.result instanceof Error) {
      throw this.result;
    }

    return this.result;
  }
}

const baseRequest: VideoPublishRequest = {
  requestId: "req-1",
  userId: "user-1",
  title: "Video title",
  description: "Custom description",
  videoUrl: "https://example.com/video.mp4",
  platforms: ["youtube"],
  roteiro: "Custom roteiro",
  script: "Custom script",
  createdAt: new Date().toISOString(),
};

describe("PublicacaoService", () => {
  it("uses provided description, roteiro and script", async () => {
    const adapters = new Map<Platform, IVideoPlatformAdapter>([
      ["youtube", new FakeAdapter("youtube", { platform: "youtube", status: "success" })],
    ]);
    const service = new PublicacaoService(new GeminiAdapter(), adapters);

    const result = await service.process({ ...baseRequest });

    expect(result.roteiro).toBe("Custom roteiro");
    expect(result.script).toBe("Custom script");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("success");
  });

  it("marks platform as failed when adapter is missing", async () => {
    const adapters = new Map<Platform, IVideoPlatformAdapter>();
    const service = new PublicacaoService(new GeminiAdapter(), adapters);

    const result = await service.process({
      ...baseRequest,
      platforms: ["youtube", "tiktok"],
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].message).toBe("Platform not configured");
  });

  it("captures adapter errors", async () => {
    const adapters = new Map<Platform, IVideoPlatformAdapter>([
      [
        "youtube",
        new FakeAdapter("youtube", new Error("Adapter error")),
      ],
    ]);
    const service = new PublicacaoService(new GeminiAdapter(), adapters);

    const result = await service.process({ ...baseRequest });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].message).toBe("Adapter error");
  });
});
