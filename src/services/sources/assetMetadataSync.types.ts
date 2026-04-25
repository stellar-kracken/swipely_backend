import type { AssetMetadata } from "../assetMetadata.service.js";

export interface MetadataSyncContext {
  symbol: string;
  assetId: string;
  existing: AssetMetadata | null;
}

export interface MetadataSourcePayload {
  source: string;
  confidence: number;
  data: Partial<
    Pick<
      AssetMetadata,
      | "logo_url"
      | "description"
      | "website_url"
      | "documentation_url"
      | "category"
      | "tags"
      | "social_links"
      | "token_specifications"
    >
  >;
}

export interface MetadataSourceAdapter {
  readonly source: string;
  supports(symbol: string): boolean;
  fetch(context: MetadataSyncContext): Promise<MetadataSourcePayload | null>;
}
