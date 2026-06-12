/**
 * VTBE video extractor.
 *
 * Handles: vtbe.to
 * Logic: fetch page → unpack JS → extract m3u8 from sources:[{file:"..."}]
 *
 * Ported from old/extractor_vtbe.js
 */

import type { Extractor, ExtractorResult } from './types';
import { fetchPage, detectPacked, getAndUnpack, DEFAULT_USER_AGENT, cheerio } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';
import { config } from '../config';

const vtbeExtractor: Extractor = {
  name: 'Vtbe',
  domains: ['vtbe.to'],

  async extract(url: string, _referer: string): Promise<ExtractorResult[]> {
    const mainUrl = new URL(url).origin;

    const html = await fetchPage(url, `${mainUrl}/`);
    if (!html) return [];

    let scriptData: string | null = null;
    if (detectPacked(html)) {
      scriptData = getAndUnpack(html);
    } else {
      const $ = cheerio.load(html);
      $('script').each((_, el) => {
        const content = $(el).html() || '';
        if (content.includes('sources:') || content.includes('file:')) {
          scriptData = content;
        }
      });
    }

    if (!scriptData) return [];

    const m3u8Match = scriptData.match(/sources:\s*\[\s*\{\s*file:\s*"(.*?)"/);
    if (!m3u8Match) return [];

    const m3u8Url = m3u8Match[1];
    const headers = { 'Referer': `${mainUrl}/`, 'User-Agent': DEFAULT_USER_AGENT };
    const minRes = parseInt(config.MIN_RESOLUTION) || 720;

    const variant = await resolveHlsBestVariant(m3u8Url, { headers, minResolution: minRes });
    if (variant) {
      return [{ url: variant.url, quality: `${variant.height}p`, isHls: true, headers }];
    }

    return [{ url: m3u8Url, quality: 'Auto', isHls: true, headers }];
  },
};

export default vtbeExtractor;
