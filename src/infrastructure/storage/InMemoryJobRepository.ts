import type {
  IJobRepository,
  JobRecord,
  JobStatus,
} from "../../application/interfaces/IJobRepository";
import type {
  VideoPublishRequest,
  VideoPublishResult,
} from "../../application/models/VideoPublish";

export class InMemoryJobRepository implements IJobRepository {
  private readonly jobs = new Map<string, JobRecord>();

  async create(request: VideoPublishRequest): Promise<JobRecord> {
    const now = new Date().toISOString();
    const record: JobRecord = {
      requestId: request.requestId,
      status: "queued",
      request,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(request.requestId, record);
    return record;
  }

  async setStatus(
    requestId: string,
    status: JobStatus,
    error?: string
  ): Promise<void> {
    const record = this.jobs.get(requestId);
    if (!record) {
      return;
    }

    record.status = status;
    record.error = error;
    record.updatedAt = new Date().toISOString();
  }

  async setResult(
    requestId: string,
    result: VideoPublishResult
  ): Promise<void> {
    const record = this.jobs.get(requestId);
    if (!record) {
      return;
    }

    record.result = result;
    record.status = "completed";
    record.updatedAt = new Date().toISOString();
  }

  async getById(requestId: string): Promise<JobRecord | undefined> {
    return this.jobs.get(requestId);
  }

  async clearAll(): Promise<number> {
    const count = this.jobs.size;
    this.jobs.clear();
    return count;
  }
}
