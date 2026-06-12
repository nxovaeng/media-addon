/**
 * Dailymotion video extractor.
 *
 * Resolves a Dailymotion video ID to HLS stream URLs via their player metadata API.
 * Supports both standard and geo-restricted embeds.
 */

import axios from 'axios';
import { config } from '../config';
import type { Extractor, ExtractorResult } from './types';
import { DEFAULT_USER_AGENT } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';

const DM_METADATA_URL = 'https://www.dailymotion.com/player/metadata/video/';
const QUALITY_PREFERENCE = ['2160', '1440', '1080', '720', 'auto'];

const DM_HEADERS = {
  'User-Agent': DEFAULT_USER_AGENT,
  'Referer': 'https://www.dailymotion.com/',
  'Origin': 'https://www.dailymotion.com',
};

/**
 * Extract the Dailymotion video ID from various URL patterns.
 */
function extractVideoId(url: string): string | null {
  // Standard embed: dailymotion.com/embed/video/<ID>
  const embedMatch = url.match(/dailymotion\.com\/embed\/video\/([a-zA-Z0-9]+)/);
  if (embedMatch) return embedMatch[1];

  // Geo player: geo.dailymotion.com/player/xxx?video=<ID>
  const geoMatch = url.match(/geo\.dailymotion\.com\/player\/[^?]+\?.*video=([a-zA-Z0-9]+)/);
  if (geoMatch) return geoMatch[1];

  // Direct: dailymotion.com/video/<ID>
  const directMatch = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
  if (directMatch) return directMatch[1];

  return null;
}

/**
 * Resolve a Dailymotion video ID to its best HLS stream.
 * Public API used directly by providers (e.g., DonghuaFun).
 */
export async function resolveDailymotionHLS(videoId: string): Promise<ExtractorResult | null> {
  const minQuality = parseInt(config.MIN_RESOLUTION) || 720;
  const metaUrl = `${DM_METADATA_URL}${videoId}`;

  try {
    const res = await axios.get(metaUrl, {
      headers: DM_HEADERS,
      timeout: 15000,
      validateStatus: (status) => status < 500,
    });

    const data = res.data;

    // Handle geo-restricted responses containing the real video ID
    if (data?.error) {
      let realVideoId = videoId;
      if (data.id) {
        realVideoId = data.id;
      } else if (data.url) {
        const realMatch = data.url.match(/\/video\/([kx][a-zA-Z0-9]+)/);
        if (realMatch) realVideoId = realMatch[1];
      }

      if (realVideoId !== videoId) {
        console.log(`[Dailymotion] Found real ID ${realVideoId} from error response, retrying...`);
        return resolveDailymotionHLS(realVideoId);
      }
    }

    const qualities = data?.qualities;
    if (!qualities) {
      console.error(`[Dailymotion] No qualities in metadata for ${videoId}`);
      return null;
    }

    // First pass: find the best specific quality at or above minQuality
    for (const q of QUALITY_PREFERENCE) {
      if (q === 'auto') continue;
      const qNum = parseInt(q);
      if (qNum < minQuality) continue;

      const entries = qualities[q];
      if (!entries?.length) continue;

      const hls = entries.find((e: any) =>
        e.type === 'application/x-mpegURL' || (e.url?.includes('.m3u8')),
      );
      const mp4 = entries.find((e: any) =>
        e.type === 'video/mp4' || (e.url?.includes('.mp4')),
      );
      const chosen = hls || mp4;

      if (chosen?.url) {
        const isHls = chosen.url.includes('.m3u8');
        return {
          url: chosen.url,
          quality: `${q}p`,
          isHls,
          headers: { 'Referer': 'https://geo.dailymotion.com/', 'Origin': 'https://geo.dailymotion.com' },
        };
      }
    }

    // Fallback: "auto" master manifest — resolve to best variant
    const autoEntries = qualities['auto'];
    if (autoEntries?.length) {
      const hls = autoEntries.find((e: any) =>
        e.type === 'application/x-mpegURL' || (e.url?.includes('.m3u8')),
      );
      if (hls?.url) {
        // Resolve master playlist to lock a specific variant
        const variant = await resolveHlsBestVariant(hls.url, {
          headers: { 'Referer': 'https://geo.dailymotion.com/', 'Origin': 'https://geo.dailymotion.com' },
          minResolution: minQuality,
        });

        if (variant) {
          return {
            url: variant.url,
            quality: `${variant.height}p`,
            isHls: true,
            headers: { 'Referer': 'https://geo.dailymotion.com/', 'Origin': 'https://geo.dailymotion.com' },
          };
        }

        // Variant resolution failed — return master with best label
        const availableQualities = Object.keys(qualities)
          .filter(k => k !== 'auto' && parseInt(k) >= minQuality)
          .map(k => parseInt(k))
          .sort((a, b) => b - a);
        const bestLabel = availableQualities.length > 0 ? `${availableQualities[0]}p` : '720p+';

        return {
          url: hls.url,
          quality: bestLabel,
          isHls: true,
          headers: { 'Referer': 'https://geo.dailymotion.com/', 'Origin': 'https://geo.dailymotion.com' },
        };
      }
    }

    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Dailymotion] Metadata fetch failed for ${videoId}: ${msg}`);
    return null;
  }
}

const dailymotionExtractor: Extractor = {
  name: 'Dailymotion',
  domains: ['dailymotion.com', 'geo.dailymotion.com'],

  async extract(url: string, _referer: string): Promise<ExtractorResult[]> {
    const videoId = extractVideoId(url);
    if (!videoId) return [];

    const result = await resolveDailymotionHLS(videoId);
    return result ? [result] : [];
  },
};

export default dailymotionExtractor;
