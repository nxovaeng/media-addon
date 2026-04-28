import { MetaStandard, StreamStandard, SubtitleStandard, Manifest as StremioManifest } from 'stremio-addon-sdk';

/**
 * Protocol Manifest mapping
 */
export type Manifest = StremioManifest;

/**
 * Internal MediaItem used for cross-provider resolution.
 */
export interface MediaItem extends Meta {
  tmdbid?: string;
  imdbid?: string;
  aliases?: string[];
  year?: number;
  season?: number;
  episode?: number;
}

/**
 * Standard Meta Object (Internal extension)
 * Aligned with MetaStandard for protocol compliance.
 */
export interface Meta extends Partial<MetaStandard> {
  id: string; 
  type: 'movie' | 'series' | 'channel' | 'tv';
  name: string; // Required by protocol
  title?: string; // Internal alias for name
  year?: number;  // Internal alias for releaseInfo
  aliases?: string[];
}

/**
 * Standard Stream Object (Internal extension)
 */
export interface Stream extends StreamStandard {
  weight?: number;
}

/**
 * Standard Subtitle Object (Protocol Compliant)
 */
export interface Subtitle extends SubtitleStandard {}

export interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  weight?: number;
  getStreams(item: MediaItem): Promise<Stream[]>;
  getCatalog?(type: string, extra: any): Promise<Meta[]>;
  getMeta?(id: string, type: string): Promise<Meta | null>;
  resolveMediaItem?(id: string, type: string): Promise<MediaItem | null>;
  search?(query: string, type: string): Promise<MediaItem[]>;
}

export interface AggregatorConfig {
  name: string;
  displayName: string;
  supportedTypes: ('movie' | 'series')[];
  region: 'mainland' | 'overseas' | 'all' | 'auto';
  priority?: number;
  providerIds?: string[];
  homeSource?: string;
}

export interface SiteDomain {
  name: string;
  baseUrl: string;
  weight: number;
}
