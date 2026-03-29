import type { IVideoPlatformAdapter } from "../../application/interfaces/IVideoPlatformAdapter";
import type {
  PlatformPublishResult,
  VideoPublishRequest,
} from "../../application/models/VideoPublish";

export class KwaiAdapter implements IVideoPlatformAdapter {
  readonly platform = "kwai" as const;

  async publish(
    request: VideoPublishRequest,
    description: string
  ): Promise<PlatformPublishResult> {
    void request;
    void description;
    return { platform: this.platform, status: "success" };
  }
}
