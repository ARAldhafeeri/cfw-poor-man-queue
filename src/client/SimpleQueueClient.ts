import ClientPublisher from "./ClientPublisher";
import ClientStatsRequester from "./ClientStatsRequester";
import {
  IClientConfiguration,
  IClientPublisher,
  IClientStatsRequester,
  ISimpleQueueClient,
  PublishedMessageResponse,
  QueueHealthResponse,
  QueueStatsResponse,
} from "./types";

class SimpleQueueClient implements ISimpleQueueClient {
  constructor(
    private publisher: IClientPublisher,
    private observer: IClientStatsRequester
  ) {}

  // Publish with size validation
  async publish(data: any): Promise<PublishedMessageResponse> {
    return this.publisher.publish(data);
  }

  // Enhanced stats
  async getStats(): Promise<QueueStatsResponse> {
    return this.observer.getStats();
  }

  async health(): Promise<QueueHealthResponse> {
    return this.observer.health();
  }
}

let client: ISimpleQueueClient | undefined;

export const getSimpleQueueClient = (
  config: IClientConfiguration
): ISimpleQueueClient => {
  if (!client) {
    client = new SimpleQueueClient(
      new ClientPublisher(config),
      new ClientStatsRequester(config)
    );
  }
  return client;
};
