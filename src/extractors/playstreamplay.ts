/**
 * PlayStreamPlay / AllSub Player video extractor.
 *
 * Handles: play.streamplay.co.in
 * Logic: unpack JS → extract kaken token → call API → get sources + tracks.
 *
 * Ported from old/extractor_playstreamplay.js
 */

import type { Extractor, ExtractorResult } from './types';
import { fetchPage, fetchJson, detectPacked, getAndUnpack, DEFAULT_USER_AGENT, cheerio } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';
import { config } from '../config';

const playstreamplayExtractor: Extractor = {
  name: 'PlayStreamPlay',
  domains: ['play.streamplay.co.in'],

  async extract(url: string, referer: string): Promise<ExtractorResult[]> {
    const mainUrl = new URL(url).origin;
    const headers = { 'Referer': `${mainUrl}/`, 'User-Agent': DEFAULT_USER_AGENT };
    const minRes = parseInt(config.MIN_RESOLUTION) || 720;

    const html = await fetchPage(url, referer);
    if (!html) return [];

    let scriptData: string | null = null;
    if (detectPacked(html)) {
      scriptData = getAndUnpack(html);
    } else {
      const $ = cheerio.load(html);
      $('script').each((_, el) => {
        const content = $(el).html() || '';
        if (content.includes('function(p,a,c,k,e,d)')) {
          // Try to extract and unpack inline packed JS
          const match = content.match(/eval\(function\(p,a,c,k,e,[dr]\)\{.*?\}\(.*?\)\)/s);
          if (match) {
            // Re-run through getAndUnpack
            scriptData = getAndUnpack(content);
          }
        }
      });
    }

    if (!scriptData) return [];

    const tokenMatch = scriptData.match(/kaken="(.*?)"/);
    if (!tokenMatch) return [];

    const apiData = await fetchJson(`${mainUrl}/api/?${tokenMatch[1]}`, url);
    if (!apiData) return [];

    const results: ExtractorResult[] = [];

    if (apiData.sources && Array.isArray(apiData.sources)) {
      for (const source of apiData.sources) {
        if (!source.file) continue;
        let fileUrl = source.file;
        if (fileUrl.startsWith('//')) fileUrl = 'https:' + fileUrl;
        const isHls = fileUrl.includes('.m3u8');

        if (isHls) {
          const variant = await resolveHlsBestVariant(fileUrl, {
            headers: { ...headers, 'pragma': 'no-cache' },
            minResolution: minRes,
          });
          if (variant) {
            results.push({ url: variant.url, quality: `${variant.height}p`, isHls: true, headers });
          } else {
            results.push({ url: fileUrl, quality: source.label || 'Auto', isHls: true, headers });
          }
        } else {
          results.push({ url: fileUrl, quality: source.label || 'MP4', isHls: false, headers });
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

export default playstreamplayExtractor;
