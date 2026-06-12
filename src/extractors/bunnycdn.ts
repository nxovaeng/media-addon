/**
 * BunnyCDN / BunnyStream video extractor.
 *
 * Handles: play.bunnycdn.to, iframe.mediadelivery.net, bunny.net
 * Logic: look for m3u8 in page source or construct playlist URL from embed ID.
 *
 * Ported from old/extractor_bunnycdn.js
 */

import type { Extractor, ExtractorResult } from './types';
import { fetchPage, DEFAULT_USER_AGENT } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';
import { config } from '../config';

const bunnycdnExtractor: Extractor = {
  name: 'BunnyCDN',
  domains: ['play.bunnycdn.to', 'iframe.mediadelivery.net', 'bunny.net'],

  async extract(url: string, referer: string): Promise<ExtractorResult[]> {
    const origin = new URL(url).origin;
    const headers = { 'Referer': origin + '/', 'User-Agent': DEFAULT_USER_AGENT };
    const minRes = parseInt(config.MIN_RESOLUTION) || 720;

    const html = await fetchPage(url, referer || 'https://animekhor.org/');
    if (!html) return [];

    const results: ExtractorResult[] = [];

    // Pattern 1: direct m3u8 in page source
    const m3u8Re = /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/g;
    const seen = new Set<string>();
    let m;
    while ((m = m3u8Re.exec(html)) !== null) {
      const streamUrl = m[1].replace(/\\\//g, '/');
      if (seen.has(streamUrl)) continue;
      seen.add(streamUrl);

      const variant = await resolveHlsBestVariant(streamUrl, { headers, minResolution: minRes });
      if (variant) {
        results.push({ url: variant.url, quality: `${variant.height}p`, isHls: true, headers });
      } else {
        results.push({ url: streamUrl, quality: 'Auto', isHls: true, headers });
      }
    }

    // Pattern 2: iframe.mediadelivery.net embed → construct playlist URL
    if (results.length === 0) {
      const bunnyMatch = url.match(/iframe\.mediadelivery\.net\/embed\/(\d+)\/([a-f0-9-]+)/i);
      if (bunnyMatch) {
        const [, libraryId, videoId] = bunnyMatch;
        const playlistUrl = `https://video.bunnycdn.com/play/${libraryId}/${videoId}/playlist.m3u8`;

        const variant = await resolveHlsBestVariant(playlistUrl, { headers, minResolution: minRes });
        if (variant) {
          results.push({ url: variant.url, quality: `${variant.height}p`, isHls: true, headers });
        } else {
          results.push({ url: playlistUrl, quality: 'Auto', isHls: true, headers });
        }
      }
    }

    return results;
  },
};

export default bunnycdnExtractor;
