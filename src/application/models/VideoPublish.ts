export type Platform = "youtube" | "tiktok" | "instagram_reels" | "kwai";

export type PublishStatus = "success" | "failed";

export interface VideoPublishInput {
  userId: string;
  title: string;
  description?: string;
  videoUrl: string;
  platforms: Platform[];
  roteiro?: string;
  script?: string;
  idea?: string;
  avatarImageBase64?: string;
  avatarImageMimeType?: string;
  language?: string;
  tone?: string;
  audience?: string;
  totalDurationSec?: number;
  brollRatio?: number;
  visualStyle?: string;
  allowSelfieLook?: boolean;
  metadata?: Record<string, string>;
}

export interface TtsResult {
  audioContent: Buffer;
}

export interface VideoPublishRequest extends VideoPublishInput {
  requestId: string;
  createdAt: string;
}

export type VisualType = "talking_head" | "broll";

export interface RoteiroPart {
  id: number;
  ttsText: string;
  visualType: VisualType;
  visualDirection?: string;
  brollTags?: string[];
}

export interface RoteiroPlan {
  summary: string;
  language: string;
  totalParts: number;
  partDurationSec: number;
  continuityNotes?: string;
  parts: RoteiroPart[];
}

export interface WorkflowAsset {
  partId: number;
  ttsAudioPath?: string;
  videoPath?: string;
  lipSyncPath?: string;
}

export interface WorkflowResult {
  plan: RoteiroPlan;
  assets: WorkflowAsset[];
  finalVideoPath?: string;
}

export interface PlatformPublishResult {
  platform: Platform;
  status: PublishStatus;
  message?: string;
}

export interface VideoPublishResult {
  requestId: string;
  userId: string;
  title: string;
  videoUrl: string;
  platforms: Platform[];
  roteiro: string;
  script: string;
  createdAt: string;
  completedAt: string;
  results: PlatformPublishResult[];
  workflow?: WorkflowResult;
}

export function isVideoPublishRequest(payload: unknown): payload is VideoPublishRequest {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    typeof candidate.requestId === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.videoUrl === "string" &&
    Array.isArray(candidate.platforms) &&
    typeof candidate.createdAt === "string"
  );
}
