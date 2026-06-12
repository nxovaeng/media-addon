/**
 * StreamWish video extractor.
 *
 * Handles: embedwish.com, swhoi.com, streamwish.to, and many mirrors.
 * Logic: fetch embed page → unpack JS or find JWPlayer script → extract m3u8.
 *
 * Ported from old/extractor_streamwish.js
 */

import type { Extractor, ExtractorResult } from './types';
import { fetchPage, detectPacked, getAndUnpack, DEFAULT_USER_AGENT, cheerio } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';
import { config } from '../config';

const streamwishExtractor: Extractor = {
  name: 'StreamWish',
  domains: [
    'embedwish.com', 'swhoi.com', 'streamwish.to', 'mwish.pro', 'dwish.pro',
    'wishembed.pro', 'kswplayer.info', 'wishfast.top', 'streamwish.site',
    'sfastwish.com', 'strwish.xyz', 'strwish.com', 'flaswish.com', 'awish.pro',
    'obeywish.com', 'jodwish.com', 'cdnwish.com', 'asnwish.com', 'swdyu.com',
    'wishonly.site', 'playerwish.com', 'streamhls.to', 'hlswish.com',
  ],

  async extract(url: string, referer: string): Promise<ExtractorResult[]> {
    const mainUrl = new URL(url).origin;

    // Resolve embed URL: /f/ or /e/ → root path
    let embedUrl = url;
    if (url.includes('/f/')) {
      embedUrl = `${mainUrl}/${url.split('/f/')[1]}`;
    } else if (url.includes('/e/')) {
      embedUrl = `${mainUrl}/${url.split('/e/')[1]}`;
    }

    const html = await fetchPage(embedUrl, referer);
    if (!html) return [];

    // Extract script data: packed JS or JWPlayer setup
    let scriptData: string | null = null;
    if (detectPacked(html)) {
      scriptData = getAndUnpack(html);
    } else {
      const $ = cheerio.load(html);
      $('script').each((_, el) => {
        const content = $(el).html() || '';
        if (content.includes('jwplayer') && content.includes('.setup(')) {
          scriptData = content;
        } else if (content.includes('sources:') && !scriptData) {
          scriptData = content;
        }
      });
    }

    if (!scriptData) return [];

    const m3u8Match = scriptData.match(/file:\s*"(.*?m3u8.*?)"/);
    if (!m3u8Match) return [];

    const m3u8Url = m3u8Match[1];
    const headers = {
      'Referer': `${mainUrl}/`,
      'Origin': mainUrl,
      'User-Agent': DEFAULT_USER_AGENT,
    };

    // Resolve HLS variant to lock resolution
    const minRes = parseInt(config.MIN_RESOLUTION) || 720;
    const variant = await resolveHlsBestVariant(m3u8Url, { headers, minResolution: minRes });

    if (variant) {
      return [{
        url: variant.url,
        quality: `${variant.height}p`,
        isHls: true,
        headers,
      }];
    }

    return [{
      url: m3u8Url,
      quality: 'Auto',
      isHls: true,
      headers,
    }];
  },
};

export default streamwishExtractor;
