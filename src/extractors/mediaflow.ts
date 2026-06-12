/**
 * MediaFlow Extractor API fallback.
 *
 * For sites without a custom extractor, falls back to MediaFlow Proxy's
 * /extractor/video endpoint. Note: this doesn't allow resolution control.
 *
 * Migrated from utils/mediaflow.ts resolveViaMediaflowExtractor().
 */

import axios from 'axios';
import { config } from '../config';
import type { Extractor, ExtractorResult } from './types';

/**
 * Map of domain keywords → MediaFlow extractor names.
 * Used as fallback when no custom extractor matches.
 */
const EXTRACTOR_MAP: Record<string, string> = {
  'dood': 'doodstream',
  'f16px': 'f16px',
  'fastream': 'fastream',
  'gupload': 'gupload',
  'livetv': 'livetv',
  'lulustream': 'lulustream',
  'maxstream': 'maxstream',
  'mixdrop': 'mixdrop',
  'sportsonline': 'sportsonline',
  'streamtape': 'streamtape',
  'supervideo': 'supervideo',
  'turbovidplay': 'turbovidplay',
  'uqload': 'uqload',
  'vavoo': 'vavoo',
  'vidfast': 'vidfast',
  'vidoza': 'vidoza',
  'vixcloud': 'vixcloud',
  'voe': 'voe',
  // Sites with custom extractors are intentionally excluded:
  // streamwish, filelions/vidhide, filemoon/filesim, vidmoly, ok.ru, city, vtbe
};

/**
 * Check if a hostname is handled by the MediaFlow fallback extractor.
 */
export function isMediaFlowFallbackDomain(hostname: string): boolean {
  return Object.keys(EXTRACTOR_MAP).some(key => hostname.includes(key));
}

/**
 * Get the MediaFlow extractor name for a hostname.
 */
export function getMediaFlowExtractorName(hostname: string): string | null {
  const key = Object.keys(EXTRACTOR_MAP).find(k => hostname.includes(k));
  return key ? EXTRACTOR_MAP[key] : null;
}

/**
 * Call MediaFlow Proxy's extractor API to resolve an embed URL.
 */
export async function resolveViaMediaflowExtractor(
  host: string,
  embedUrl: string,
): Promise<ExtractorResult | null> {
  if (!config.MEDIAFLOW_PROXY_URL) return null;

  try {
    const params = new URLSearchParams({
      host: host.toLowerCase(),
      d: embedUrl,
    });
    if (config.MEDIAFLOW_API_PASSWORD) {
      params.set('api_password', config.MEDIAFLOW_API_PASSWORD);
    }

    const url = `${config.MEDIAFLOW_PROXY_URL}/extractor/video?${params.toString()}`;
    const res = await axios.get(url, { timeout: 15000 });

    if (res.data?.url) {
      return {
        url: res.data.url,
        quality: 'Auto',
        isHls: res.data.is_hls ?? res.data.url.includes('.m3u8'),
        headers: res.data.headers,
      };
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MediaFlow] Extractor error for ${host} (${embedUrl}): ${msg}`);
    return null;
  }
}

/**
 * MediaFlow fallback extractor — used when no custom extractor matches.
 * Cannot control resolution, but provides broad site coverage.
 */
const mediaflowExtractor: Extractor = {
  name: 'MediaFlow',
  domains: Object.keys(EXTRACTOR_MAP),

  async extract(url: string, _referer: string): Promise<ExtractorResult[]> {
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      return [];
    }

    const extractorName = getMediaFlowExtractorName(hostname);
    if (!extractorName) return [];

    const result = await resolveViaMediaflowExtractor(extractorName, url);
    return result ? [result] : [];
  },
};

export default mediaflowExtractor;
