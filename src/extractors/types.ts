/**
 * Shared types for video extractors.
 *
 * Each extractor resolves an embed URL → real video URL(s) with metadata.
 */

/** Result from an individual extractor */
export interface ExtractorResult {
  /** Direct video URL (mp4, m3u8, etc.) */
  url: string;
  /** Quality label (e.g. "1080p", "720p", "Auto") */
  quality: string;
  /** Whether the URL is an HLS manifest */
  isHls: boolean;
  /** Headers required to access the video URL */
  headers?: Record<string, string>;
  /** Subtitles discovered during extraction */
  subtitles?: Array<{ url: string; label: string }>;
}

/** Interface every extractor must implement */
export interface Extractor {
  /** Human-readable name */
  name: string;
  /** Domains this extractor handles (matched with `hostname.includes(domain)`) */
  domains: string[];
  /** Extract video URLs from an embed page */
  extract(url: string, referer: string): Promise<ExtractorResult[]>;
}
