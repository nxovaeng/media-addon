/**
 * EmTurboVid video extractor.
 *
 * Handles: emturbovid.com
 * Logic: fetch page → find var urlPlay → extract m3u8 URL.
 *
 * Ported from old/extractor_emturbovid.js
 */

import type { Extractor, ExtractorResult } from './types';
import { fetchPage, DEFAULT_USER_AGENT, cheerio } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';
import { config } from '../config';

const emturbovidExtractor: Extractor = {
  name: 'Emturbovid',
  domains: ['emturbovid.com'],

  async extract(url: string, referer: string): Promise<ExtractorResult[]> {
    const mainUrl = 'https://emturbovid.com';

    const html = await fetchPage(url, referer || `${mainUrl}/`);
    if (!html) return [];

    const $ = cheerio.load(html);
    let playerScript: string | null = null;
    $('script').each((_, el) => {
      const content = $(el).html() || '';
      if (content.includes('var urlPlay')) {
        playerScript = content;
      }
    });

    if (!playerScript) return [];

    const m3u8Match = (playerScript as string).match(/var urlPlay\s*=\s*'([^']+)'/);
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

export default emturbovidExtractor;
