import type { KonepsCallMetadata, KonepsErrorCategory } from "./types.js";

export class KonepsError extends Error {
  readonly category: KonepsErrorCategory;
  readonly metadata?: KonepsCallMetadata;

  constructor(category: KonepsErrorCategory, message: string, metadata?: KonepsCallMetadata) {
    super(message);
    this.name = "KonepsError";
    this.category = category;
    this.metadata = metadata;
  }
}
