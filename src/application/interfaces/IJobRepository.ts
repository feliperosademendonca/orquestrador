import type { VideoPublishRequest, VideoPublishResult } from "../models/VideoPublish";

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "queued_for_retry";

export interface JobRecord {
  requestId: string;
  status: JobStatus;
  request: VideoPublishRequest;
  result?: VideoPublishResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IJobRepository {
  create(request: VideoPublishRequest): Promise<JobRecord>;
  setStatus(requestId: string, status: JobStatus, error?: string): Promise<void>;
  setResult(requestId: string, result: VideoPublishResult): Promise<void>;
  getById(requestId: string): Promise<JobRecord | undefined>;
  clearAll(): Promise<number>;
}
