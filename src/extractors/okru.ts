/**
 * OK.ru (Odnoklassniki) video extractor.
 *
 * Directly parses the videoembed page to extract MP4 URLs with quality labels.
 * Does NOT use MediaFlow extractor — resolves all qualities natively.
 *
 * Ported from old/extractor_okru.js
 */

import { config } from '../config';
import type { Extractor, ExtractorResult } from './types';
import { fetchPage, DEFAULT_USER_AGENT } from './utils';

const QUALITY_MAP: Record<string, number> = {
  'mobile': 144,
  'lowest': 240,
  'low': 360,
  'sd': 480,
  'hd': 720,
  'full': 1080,
  'quad': 1440,
  'ultra': 2160,
};

const okruExtractor: Extractor = {
  name: 'OkRu',
  domains: ['ok.ru', 'odnoklassniki.ru', 'm.ok.ru'],

  async extract(url: string, _referer: string): Promise<ExtractorResult[]> {
    const minHeight = parseInt(config.MIN_RESOLUTION) || 720;

    // Normalize to videoembed format
    const embedUrl = url
      .replace('/video/', '/videoembed/')
      .replace('m.ok.ru', 'ok.ru');

    const html = await fetchPage(embedUrl, 'https://ok.ru/', {
      'Accept': '*/*',
      'Origin': 'https://ok.ru',
    });
    if (!html) return [];

    // Unescape the response
    const cleaned = html
      .replace(/\\&quot;/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );

    // Extract videos JSON array
    const videosMatch = cleaned.match(/"videos":(\[[^\]]*\])/);
    if (!videosMatch) {
      console.warn('[OkRu] No videos array found in page');
      return [];
    }

    try {
      const videos: Array<{ url: string; name: string }> = JSON.parse(videosMatch[1]);
      const results: ExtractorResult[] = [];

      for (const video of videos) {
        if (!video.url || !video.name) continue;

        let videoUrl = video.url;
        if (videoUrl.startsWith('//')) videoUrl = 'https:' + videoUrl;

        const qualityKey = video.name.toLowerCase();
        const height = QUALITY_MAP[qualityKey] || 0;

        // Filter by minimum resolution
        if (height > 0 && height < minHeight) continue;

        results.push({
          url: videoUrl,
          quality: height ? `${height}p` : video.name,
          isHls: videoUrl.includes('.m3u8'),
          headers: {
            'Referer': 'https://ok.ru/',
            'User-Agent': DEFAULT_USER_AGENT,
          },
        });
      }

      // Sort by resolution descending
      results.sort((a, b) => {
        const hA = parseInt(a.quality) || 0;
        const hB = parseInt(b.quality) || 0;
        return hB - hA;
      });

      return results;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[OkRu] Failed to parse videos JSON: ${msg}`);
      return [];
    }
  },
};

export default okruExtractor;
