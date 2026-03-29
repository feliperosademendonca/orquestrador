export type QueueHandler = (payload: unknown) => Promise<void>;

export interface IQueueProvider {
  connect(): Promise<void>;
  publish(queueName: string, payload: unknown): Promise<void>;
  subscribe(queueName: string, handler: QueueHandler): Promise<void>;
  close(): Promise<void>;
}
