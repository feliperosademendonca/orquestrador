import type {
  IQueueProvider,
  QueueHandler,
} from "../../application/interfaces/IQueueProvider";

export class InMemoryQueueAdapter implements IQueueProvider {
  private readonly handlers = new Map<string, QueueHandler>();

  async connect(): Promise<void> {
    return;
  }

  async publish(queueName: string, payload: unknown): Promise<void> {
    const handler = this.handlers.get(queueName);
    if (!handler) {
      return;
    }

    setImmediate(() => {
      void handler(payload);
    });
  }

  async subscribe(queueName: string, handler: QueueHandler): Promise<void> {
    this.handlers.set(queueName, handler);
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
