import {
  IClientConfiguration,
  IClientStatsRequester,
  QueueHealthResponse,
  QueueStatsResponse,
} from "./types";

class ClientStatsRequester implements IClientStatsRequester {
  constructor(private config: IClientConfiguration) {}
  // Enhanced stats
  async getStats(): Promise<QueueStatsResponse> {
    const response = await fetch(`${this.config.baseUrl}/stats`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Stats failed: ${response.statusText}`);
    }

    return response.json();
  }

  async health(): Promise<QueueHealthResponse> {
    const response = await fetch(`${this.config.baseUrl}/health`, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    return response.json();
  }
}

export default ClientStatsRequester;
