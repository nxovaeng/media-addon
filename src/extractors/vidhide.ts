/**
 * VidHide / FileLions video extractor.
 *
 * Handles: vidhidepro.com, filelions.live, filelions.to, etc.
 * Logic: fetch embed page → unpack JS → extract m3u8 from file:/hls2:/hls4: fields.
 *
 * Ported from old/extractor_vidhide.js
 */

import type { Extractor, ExtractorResult } from './types';
import { fetchPage, detectPacked, getAndUnpack, DEFAULT_USER_AGENT, cheerio } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';
import { config } from '../config';

const vidhideExtractor: Extractor = {
  name: 'VidHide',
  domains: [
    'vidhidepro.com', 'vidhidevip.com', 'vidhidehub.com', 'vidhidepre.com',
    'filelions.live', 'filelions.online', 'filelions.to', 'filelions.com',
    'ryderjet.com', 'smoothpre.com', 'dhtpre.com', 'peytonepre.com',
  ],

  async extract(url: string, referer: string): Promise<ExtractorResult[]> {
    const mainUrl = new URL(url).origin;

    // Resolve embed URL: /d/ /download/ /file/ /f/ → /v/
    let embedUrl = url;
    if (url.includes('/d/')) embedUrl = url.replace('/d/', '/v/');
    else if (url.includes('/download/')) embedUrl = url.replace('/download/', '/v/');
    else if (url.includes('/file/')) embedUrl = url.replace('/file/', '/v/');
    else if (url.includes('/f/')) embedUrl = url.replace('/f/', '/v/');

    const html = await fetchPage(embedUrl, referer);
    if (!html) return [];

    let scriptData: string | null = null;
    if (detectPacked(html)) {
      let unpacked = getAndUnpack(html);
      if (unpacked.includes('var links')) {
        unpacked = unpacked.substring(unpacked.indexOf('var links'));
      }
      scriptData = unpacked;
    } else {
      const $ = cheerio.load(html);
      const scriptEl = $('script').filter((_, el) => {
        return ($(el).html() || '').includes('sources:');
      }).first();
      scriptData = scriptEl.html() || null;
    }

    if (!scriptData) return [];

    const results: ExtractorResult[] = [];
    const headers = {
      'Referer': `${mainUrl}/`,
      'Origin': mainUrl,
      'User-Agent': DEFAULT_USER_AGENT,
    };
    const minRes = parseInt(config.MIN_RESOLUTION) || 720;

    // Match m3u8 URLs prefixed by file:, hls2:, hls4:, etc.
    const m3u8Regex = /:\s*"(.*?m3u8.*?)"/g;
    let match;
    while ((match = m3u8Regex.exec(scriptData)) !== null) {
      let m3u8Url = match[1];
      if (m3u8Url.startsWith('//')) m3u8Url = 'https:' + m3u8Url;
      else if (m3u8Url.startsWith('/')) m3u8Url = mainUrl + m3u8Url;

      // Resolve to best variant
      const variant = await resolveHlsBestVariant(m3u8Url, { headers, minResolution: minRes });
      if (variant) {
        results.push({
          url: variant.url,
          quality: `${variant.height}p`,
          isHls: true,
          headers,
        });
      } else {
        results.push({
          url: m3u8Url,
          quality: 'Auto',
          isHls: true,
          headers,
        });
      }
      break; // Usually only need the first stream
    }

    return results;
  },
};

export default vidhideExtractor;
