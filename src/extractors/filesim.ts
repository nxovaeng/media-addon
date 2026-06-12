/**
 * FileSim / FileMoon video extractor.
 *
 * Handles: files.im, streamhide, filemoon.sx/to/in, etc.
 * Logic: fetch embed page → check iframe → unpack JS → extract m3u8.
 *
 * Ported from old/extractor_filesim.js
 */

import type { Extractor, ExtractorResult } from './types';
import { fetchPage, detectPacked, getAndUnpack, DEFAULT_USER_AGENT, cheerio } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';
import { config } from '../config';

const filesimExtractor: Extractor = {
  name: 'FileSim',
  domains: [
    'files.im', 'streamhide.to', 'streamhide.com',
    'filemoon.sx', 'filemoon.to', 'filemoon.in',
  ],

  async extract(url: string, referer: string): Promise<ExtractorResult[]> {
    const mainUrl = new URL(url).origin;

    // Ensure embed URL
    const embedUrl = url.replace('/download/', '/e/');

    const html = await fetchPage(embedUrl, referer);
    if (!html) return [];

    // Check for iframe redirect
    const $ = cheerio.load(html);
    const iframe = $('iframe').attr('src');
    let pageHtml = html;
    if (iframe) {
      const iframeHtml = await fetchPage(iframe, embedUrl);
      if (iframeHtml) pageHtml = iframeHtml;
    }

    let scriptData: string | null = null;
    if (detectPacked(pageHtml)) {
      scriptData = getAndUnpack(pageHtml);
    } else {
      const $2 = cheerio.load(pageHtml);
      $2('script').each((_, el) => {
        const content = $2(el).html() || '';
        if (content.includes('sources:') || content.includes('file:')) {
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
      'User-Agent': DEFAULT_USER_AGENT,
    };

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

export default filesimExtractor;
