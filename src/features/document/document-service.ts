import type { Md3Client } from "../../infrastructure/material/client.js";
import { renderDocument } from "./render-document.js";
import type { RenderedDocument } from "./types.js";

export class DocumentService {
  readonly #client: Md3Client;

  constructor(client: Md3Client) {
    this.#client = client;
  }

  async readDocument(input: string, requestedSection?: string): Promise<RenderedDocument> {
    const fetched = await this.#client.getDocument(input, requestedSection);
    return renderDocument(
      fetched.document,
      fetched.resolved,
      fetched.carbonVersion,
      (resourceName) => this.#client.loadResourceData(fetched.carbonVersion, resourceName),
    );
  }
}
