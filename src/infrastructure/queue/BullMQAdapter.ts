import type {
  IQueueProvider,
  QueueHandler,
} from "../../application/interfaces/IQueueProvider";

export class BullMQAdapter implements IQueueProvider {
  async connect(): Promise<void> {
    return;
  }

  async publish(queueName: string, payload: unknown): Promise<void> {
    void queueName;
    void payload;
    return;
  }

  async subscribe(queueName: string, handler: QueueHandler): Promise<void> {
    void queueName;
    void handler;
    return;
  }

  async close(): Promise<void> {
    return;
  }
}
