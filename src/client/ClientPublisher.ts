import { calculateSize } from "./payload";
import {
  IClientConfiguration,
  IClientPublisher,
  PublishedMessageResponse,
} from "./types";

class ClientPublisher implements IClientPublisher {
  constructor(private config: IClientConfiguration) {}

  // Publish with size validation
  async publish(data: any): Promise<PublishedMessageResponse> {
    const size = calculateSize(data);

    if (size > this.config.maxPayloadSize) {
      throw new Error(
        `Payload size ${size} exceeds limit ${this.config.maxPayloadSize}`
      );
    }

    const response = await fetch(`${this.config.baseUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `Publish failed: ${response.status} - ${
          (error as any).error || response.statusText
        }`
      );
    }

    return response.json();
  }
}

export default ClientPublisher;
