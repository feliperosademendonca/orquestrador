import type {
  IJobRepository,
  JobRecord,
  JobStatus,
} from "../../application/interfaces/IJobRepository";
import type {
  VideoPublishRequest,
  VideoPublishResult,
} from "../../application/models/VideoPublish";
import { MongoClient, type Collection } from "mongodb";

interface MongoJobDocument extends JobRecord {
  _id: string;
}

export class MongoJobRepository implements IJobRepository {
  private constructor(private readonly collection: Collection<MongoJobDocument>) {}

  static async connect(
    uri: string,
    dbName: string,
    collectionName: string
  ): Promise<MongoJobRepository> {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection<MongoJobDocument>(collectionName);
    await collection.createIndex({ requestId: 1 }, { unique: true });
    return new MongoJobRepository(collection);
  }

  async create(request: VideoPublishRequest): Promise<JobRecord> {
    const now = new Date().toISOString();
    const record: JobRecord = {
      requestId: request.requestId,
      status: "queued",
      request,
      createdAt: now,
      updatedAt: now,
    };

    await this.collection.insertOne({ ...record, _id: request.requestId });
    return record;
  }

  async setStatus(
    requestId: string,
    status: JobStatus,
    error?: string
  ): Promise<void> {
    await this.collection.updateOne(
      { requestId },
      {
        $set: {
          status,
          error,
          updatedAt: new Date().toISOString(),
        },
      }
    );
  }

  async setResult(
    requestId: string,
    result: VideoPublishResult
  ): Promise<void> {
    await this.collection.updateOne(
      { requestId },
      {
        $set: {
          result,
          status: "completed",
          updatedAt: new Date().toISOString(),
        },
      }
    );
  }

  async getById(requestId: string): Promise<JobRecord | undefined> {
    const record = await this.collection.findOne({ requestId });
    if (!record) {
      return undefined;
    }

    const { _id, ...job } = record;
    return job;
  }

  async clearAll(): Promise<number> {
    const result = await this.collection.deleteMany({});
    return result.deletedCount ?? 0;
  }
}
