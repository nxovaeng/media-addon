/**
 * VidStack / P2pStream video extractor.
 *
 * Handles: p2pstream.*, vidstack.*
 * Logic: fetch embed page → unpack or find script → extract file:"..." URLs.
 *
 * Ported from old/extractor_vidstack.js
 */

import type { Extractor, ExtractorResult } from './types';
import { fetchPage, detectPacked, getAndUnpack, DEFAULT_USER_AGENT, cheerio } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';
import { config } from '../config';

const vidstackExtractor: Extractor = {
  name: 'VidStack',
  domains: ['p2pstream', 'vidstack'],

  async extract(url: string, referer: string): Promise<ExtractorResult[]> {
    const mainUrl = new URL(url).origin;

    const html = await fetchPage(url, referer);
    if (!html) return [];

    let scriptData: string | null = null;
    if (detectPacked(html)) {
      scriptData = getAndUnpack(html);
    } else {
      const $ = cheerio.load(html);
      $('script').each((_, el) => {
        const content = $(el).html() || '';
        if (content.includes('sources') || content.includes('file:')) {
          scriptData = content;
        }
      });
    }

    if (!scriptData) return [];

    const results: ExtractorResult[] = [];
    const headers = { 'Referer': `${mainUrl}/`, 'User-Agent': DEFAULT_USER_AGENT };
    const minRes = parseInt(config.MIN_RESOLUTION) || 720;

    const fileRegex = /file:\s*"(https?:[^"]+)"/g;
    let match;
    while ((match = fileRegex.exec(scriptData)) !== null) {
      const fileUrl = match[1].replace(/\\\//g, '/');
      if (fileUrl.includes('.vtt') || fileUrl.includes('.srt')) continue;

      const isHls = fileUrl.includes('.m3u8');
      if (isHls) {
        const variant = await resolveHlsBestVariant(fileUrl, { headers, minResolution: minRes });
        if (variant) {
          results.push({ url: variant.url, quality: `${variant.height}p`, isHls: true, headers });
        } else {
          results.push({ url: fileUrl, quality: 'Auto', isHls: true, headers });
        }
      } else {
        results.push({ url: fileUrl, quality: 'MP4', isHls: false, headers });
      }
      break;
    }

    return results;
  },
};

export default vidstackExtractor;
