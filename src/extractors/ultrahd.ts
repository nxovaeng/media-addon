/**
 * UltraHD StreamPlay video extractor.
 *
 * Handles: ultrahd.streamplay.co.in
 * Logic: fetch page → find $.ajax URL → call API → get sources JSON.
 *
 * Ported from old/extractor_ultrahd.js
 */

import type { Extractor, ExtractorResult } from './types';
import { fetchPage, fetchJson, DEFAULT_USER_AGENT } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';
import { config } from '../config';

const ultrahdExtractor: Extractor = {
  name: 'Ultrahd',
  domains: ['ultrahd.streamplay.co.in'],

  async extract(url: string, _referer: string): Promise<ExtractorResult[]> {
    const mainUrl = new URL(url).origin;
    const headers = { 'Referer': `${mainUrl}/`, 'User-Agent': DEFAULT_USER_AGENT };
    const minRes = parseInt(config.MIN_RESOLUTION) || 720;

    const html = await fetchPage(url, `${mainUrl}/`);
    if (!html) return [];

    const ajaxMatch = html.match(/\$\.\s*ajax\s*\(\s*\{\s*url:\s*"(.*?)"/);
    if (!ajaxMatch) return [];

    const apiData = await fetchJson(ajaxMatch[1], url);
    if (!apiData) return [];

    const results: ExtractorResult[] = [];

    if (apiData.sources && Array.isArray(apiData.sources)) {
      for (const source of apiData.sources) {
        if (!source.file) continue;
        let fileUrl = source.file;
        if (fileUrl.startsWith('//')) fileUrl = 'https:' + fileUrl;
        const label = source.label || '';
        const isHls = fileUrl.includes('.m3u8');

        if (isHls) {
          const variant = await resolveHlsBestVariant(fileUrl, { headers, minResolution: minRes });
          if (variant) {
            results.push({ url: variant.url, quality: `${variant.height}p`, isHls: true, headers });
          } else {
            results.push({ url: fileUrl, quality: label || 'Auto', isHls: true, headers });
          }
        } else {
          results.push({ url: fileUrl, quality: label || 'MP4', isHls: false, headers });
        }
      }
    }

    // Extract subtitles
    if (apiData.tracks && Array.isArray(apiData.tracks) && results.length > 0) {
      const subtitles = apiData.tracks
        .filter((t: any) => t.file && t.label)
        .map((t: any) => ({ url: t.file, label: t.label }));
      if (subtitles.length > 0) results[0].subtitles = subtitles;
    }

    return results;
  },
};

export default ultrahdExtractor;
