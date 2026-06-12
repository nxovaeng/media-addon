/**
 * DonghuaPlanet / Rumble video extractor.
 *
 * Resolves DonghuaPlanet/PlayDaku embed pages backed by JWPlayer + Rumble CDN.
 * Also handles direct Rumble embeds.
 *
 * Migrated from utils/donghuaplanet.ts with HLS variant resolution.
 */

import { config } from '../config';
import type { Extractor, ExtractorResult } from './types';
import { fetchPage, DEFAULT_USER_AGENT, cheerio } from './utils';
import { resolveHlsBestVariant } from './hlsResolver';

const QUALITY_PREFERENCE = ['Auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'];

const donghuaplanetExtractor: Extractor = {
  name: 'DonghuaPlanet',
  domains: [
    'donghuaplanet.com', 'playdaku.com',
    'rumble.com', 'player.donghuaworld.in',
  ],

  async extract(url: string, referer: string): Promise<ExtractorResult[]> {
    const minRes = parseInt(config.MIN_RESOLUTION) || 720;
    const mainUrl = new URL(url).origin;

    const html = await fetchPage(url, referer, {
      'Referer': referer,
    });
    if (!html) return [];

    const results: ExtractorResult[] = [];
    const headers = { 'Referer': `${mainUrl}/`, 'User-Agent': DEFAULT_USER_AGENT };

    // ── Method 1: JWPlayer sources array ────────────────────────────────────
    const sourcesMatch = html.match(/sources\s*:\s*(\[[\s\S]*?\])\s*[,\n\r}]/);
    if (sourcesMatch) {
      const sourcesJson = sourcesMatch[1].replace(/\\\//g, '/');
      try {
        const sources = JSON.parse(sourcesJson);
        if (sources?.length > 0) {
          for (const preferredQuality of QUALITY_PREFERENCE) {
            const match = sources.find((s: any) => s.label === preferredQuality);
            if (match?.file) {
              let resolvedUrl = match.file;
              let quality = preferredQuality;
              const isHls = resolvedUrl.includes('.m3u8');

              // If "Auto" master playlist, resolve to best variant
              if (preferredQuality === 'Auto' && isHls) {
                const variant = await resolveHlsBestVariant(resolvedUrl, {
                  headers, minResolution: minRes,
                });
                if (variant) {
                  resolvedUrl = variant.url;
                  quality = `${variant.height}p`;
                }
              }

              results.push({
                url: resolvedUrl,
                quality,
                isHls,
                headers,
                subtitles: extractSubtitles(html),
              });
              break; // Use first quality hit
            }
          }

          // Fallback to any source
          if (results.length === 0) {
            const fallback = sources.find((s: any) => s.file);
            if (fallback) {
              results.push({
                url: fallback.file,
                quality: fallback.label || 'Unknown',
                isHls: fallback.file.includes('.m3u8'),
                headers,
                subtitles: extractSubtitles(html),
              });
            }
          }

          if (results.length > 0) return results;
        }
      } catch {
        // Fall through to regex
      }
    }

    // ── Method 2: Regex for Rumble player config ────────────────────────────
    const sourceRegex = /"file"\s*:\s*"(https:[^"]+\.(?:mp4|m3u8)[^"]*)"/g;
    let match;
    const mp4Sources: Array<{ url: string; quality: number }> = [];
    const m3u8Sources: Array<{ url: string; quality: number }> = [];

    while ((match = sourceRegex.exec(html)) !== null) {
      const fileUrl = match[1].replace(/\\\//g, '/');
      const qualityMatch = fileUrl.match(/(\d{3,4})p/);
      const quality = qualityMatch ? parseInt(qualityMatch[1]) : 0;

      if (quality > 0 && quality < minRes) continue;

      if (fileUrl.includes('.mp4')) {
        mp4Sources.push({ url: fileUrl, quality });
      } else if (fileUrl.includes('.m3u8')) {
        m3u8Sources.push({ url: fileUrl, quality });
      }
    }

    mp4Sources.sort((a, b) => b.quality - a.quality);
    m3u8Sources.sort((a, b) => b.quality - a.quality);

    const subs = extractSubtitles(html);

    // Prefer HLS
    if (m3u8Sources.length > 0) {
      const best = m3u8Sources[0];
      let resolvedUrl = best.url;
      let quality = best.quality > 0 ? `${best.quality}p` : 'Auto';

      // Resolve master playlist if quality unknown
      if (best.quality === 0) {
        const variant = await resolveHlsBestVariant(best.url, { headers, minResolution: minRes });
        if (variant) {
          resolvedUrl = variant.url;
          quality = `${variant.height}p`;
        }
      }

      results.push({ url: resolvedUrl, quality, isHls: true, headers, subtitles: subs });
    }

    // Fallback to MP4
    if (results.length === 0 && mp4Sources.length > 0) {
      const best = mp4Sources[0];
      results.push({
        url: best.url,
        quality: best.quality > 0 ? `${best.quality}p` : 'Unknown',
        isHls: false,
        headers,
        subtitles: subs,
      });
    }

    // ── Method 3: Rumble fallback HLS playlist URL ──────────────────────────
    if (results.length === 0) {
      const embedIdMatch = url.match(/\/embed\/v([^/]+)/);
      if (embedIdMatch) {
        const fallbackUrl = `${mainUrl}/hls-vod/v${embedIdMatch[1]}/playlist.m3u8`;
        const variant = await resolveHlsBestVariant(fallbackUrl, { headers, minResolution: minRes });
        if (variant) {
          results.push({ url: variant.url, quality: `${variant.height}p`, isHls: true, headers, subtitles: subs });
        } else {
          results.push({ url: fallbackUrl, quality: 'Auto', isHls: true, headers, subtitles: subs });
        }
      }
    }

    // ── Extract subtitles from Rumble format ─────────────────────────────────
    if (results.length > 0 && !results[0].subtitles?.length) {
      const trackRegex = /"file"\s*:\s*"(https:[^"]+\.vtt[^"]*)"\s*,\s*"label"\s*:\s*"([^"]+)"/g;
      const subtitles: Array<{ url: string; label: string }> = [];
      while ((match = trackRegex.exec(html)) !== null) {
        subtitles.push({ url: match[1].replace(/\\\//g, '/'), label: match[2] });
      }
      if (subtitles.length > 0) results[0].subtitles = subtitles;
    }

    return results;
  },
};

/**
 * Extract subtitle tracks from the embed page HTML.
 */
function extractSubtitles(body: string): Array<{ url: string; label: string }> {
  const tracksMatch = body.match(/tracks\s*[=:]\s*(\[[\s\S]*?\])\s*[;,\n\r]/);
  if (!tracksMatch) return [];

  try {
    const tracksJson = tracksMatch[1].replace(/\\\//g, '/');
    const tracks = JSON.parse(tracksJson);
    return tracks
      .filter((t: any) => t.file && t.label)
      .map((t: any) => ({ url: t.file, label: t.label }));
  } catch {
    return [];
  }
}

export default donghuaplanetExtractor;
