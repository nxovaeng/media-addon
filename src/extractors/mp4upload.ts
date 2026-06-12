/**
 * MP4Upload video extractor.
 *
 * Handles: mp4upload.com
 * Logic: fetch embed page → unpack packed JS → extract src from player.src("...")
 *
 * Ported from old/extractor_mp4upload.js
 */

import type { Extractor, ExtractorResult } from './types';
import { fetchPage, detectPacked, getAndUnpack, DEFAULT_USER_AGENT } from './utils';

const mp4uploadExtractor: Extractor = {
  name: 'Mp4Upload',
  domains: ['mp4upload.com'],

  async extract(url: string, referer: string): Promise<ExtractorResult[]> {
    const mainUrl = 'https://www.mp4upload.com';

    // Normalize URL to embed format
    const idMatch = url.match(/mp4upload\.com\/(embed-|)([A-Za-z0-9]*)/);
    const realUrl = idMatch ? `${mainUrl}/embed-${idMatch[2]}.html` : url;

    const html = await fetchPage(realUrl, referer);
    if (!html) return [];

    const unpacked = detectPacked(html) ? getAndUnpack(html) : html;

    // Try both src patterns
    const srcMatch = unpacked.match(/player\.src\("(.*?)"/) ||
                     unpacked.match(/player\.src\([\w\W]*src:\s*"(.*?)"/);

    if (!srcMatch) return [];

    const quality = unpacked.toLowerCase().match(/height=(\d+)/);

    return [{
      url: srcMatch[1],
      quality: quality ? `${quality[1]}p` : 'Unknown',
      isHls: srcMatch[1].includes('.m3u8'),
      headers: {
        'Referer': realUrl,
        'User-Agent': DEFAULT_USER_AGENT,
      },
    }];
  },
};

export default mp4uploadExtractor;
