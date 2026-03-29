import type {
  Platform,
  PlatformPublishResult,
  VideoPublishRequest,
} from "../models/VideoPublish";

export interface IVideoPlatformAdapter {
  readonly platform: Platform;
  publish(
    request: VideoPublishRequest,
    description: string
  ): Promise<PlatformPublishResult>;
}
