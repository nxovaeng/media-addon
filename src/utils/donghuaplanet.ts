/**
 * Resolve a DonghuaPlanet embed URL to its real video stream URL.
 *
 * DonghuaPlanet uses JWPlayer backed by Rumble CDN. The embed page HTML
 * contains an inline `sources: [...]` JSON array with multiple quality
 * levels (240p–1440p HLS chunks + an "Auto" master HLS playlist).
 *
 * We prefer the Auto (master) HLS playlist since MediaFlow can select
 * the best quality at playback time. If Auto is unavailable we fall
 * back to the highest individual resolution.
 */

import axios from 'axios';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const QUALITY_PREFERENCE = ['Auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'];

export interface DonghuaPlanetResult {
  url: string;
  quality: string;
  subtitles?: Array<{ url: string; label: string }>;
}

/**
 * Resolve a DonghuaPlanet embed URL to its best HLS stream URL.
 *
 * @param embedUrl - Full embed URL, e.g. https://player.donghuaplanet.com/v76pfla
 * @param referer - Referer header to send (the originating site URL)
 */
export async function resolveDonghuaPlanet(
  embedUrl: string,
  referer: string = 'https://donghuaworld.com/'
): Promise<DonghuaPlanetResult | null> {
  try {
    const res = await axios.get(embedUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        'Referer': referer,
      },
      timeout: 15000,
    });

    const body: string = res.data;

    // First attempt: JWPlayer sources array (DonghuaPlanet/PlayDaku)
    const sourcesMatch = body.match(/sources\s*:\s*(\[[\s\S]*?\])\s*[,\n\r}]/);
    if (sourcesMatch) {
      let sourcesJson = sourcesMatch[1].replace(/\\\//g, '/');
      try {
        const sources = JSON.parse(sourcesJson);
        if (sources && sources.length > 0) {
          for (const preferredQuality of QUALITY_PREFERENCE) {
            const match = sources.find((s: any) => s.label === preferredQuality);
            if (match && match.file) {
              return {
                url: match.file,
                quality: preferredQuality === 'Auto' ? 'Auto' : preferredQuality,
                subtitles: extractSubtitles(body),
              };
            }
          }
          const fallback = sources.find((s: any) => s.file);
          if (fallback) {
            return {
              url: fallback.file,
              quality: fallback.label || 'unknown',
              subtitles: extractSubtitles(body),
            };
          }
        }
      } catch (parseErr) {
        // Ignore parse error and fall through to regex
      }
    }

    // Second attempt: Direct regex for Rumble player config or other inline JSON
    const sourceRegex = /"file"\s*:\s*"(https:[^"]+\.(?:mp4|m3u8)[^"]*)"/g;
    let match;
    const mp4Sources = [];
    const m3u8Sources = [];

    while ((match = sourceRegex.exec(body)) !== null) {
        const fileUrl = match[1].replace(/\\\//g, '/');
        const qualityMatch = fileUrl.match(/(\d{3,4})p/);
        const quality = qualityMatch ? parseInt(qualityMatch[1]) : 0;

        if (fileUrl.includes('.mp4')) {
            mp4Sources.push({ url: fileUrl, quality });
        } else if (fileUrl.includes('.m3u8')) {
            m3u8Sources.push({ url: fileUrl, quality });
        }
    }

    mp4Sources.sort((a, b) => b.quality - a.quality);
    m3u8Sources.sort((a, b) => b.quality - a.quality);

    // Prefer HLS
    if (m3u8Sources.length > 0) {
      const best = m3u8Sources[0];
      return {
        url: best.url,
        quality: best.quality > 0 ? `${best.quality}p` : 'Auto',
        subtitles: extractSubtitles(body),
      };
    }

    // Fallback to MP4
    if (mp4Sources.length > 0) {
      const best = mp4Sources[0];
      return {
        url: best.url,
        quality: best.quality > 0 ? `${best.quality}p` : 'Unknown',
        subtitles: extractSubtitles(body),
      };
    }

    // Final fallback for Rumble: Try to build HLS playlist URL from embed ID
    const embedIdMatch = embedUrl.match(/\/embed\/v([^/]+)/);
    if (embedIdMatch) {
        const embedId = embedIdMatch[1];
        const mainUrl = new URL(embedUrl).origin;
        const fallbackUrl = `${mainUrl}/hls-vod/v${embedId}/playlist.m3u8`;
        return {
            url: fallbackUrl,
            quality: 'Auto',
            subtitles: extractSubtitles(body),
        };
    }

    console.error(`[DonghuaPlanet] No sources found in embed page: ${embedUrl}`);
    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DonghuaPlanet] Resolve failed for ${embedUrl}: ${message}`);
    return null;
  }
}

/**
 * Extract subtitle tracks from the embed page HTML.
 */
function extractSubtitles(body: string): Array<{ url: string; label: string }> {
  const tracksMatch = body.match(/tracks\s*[=:]\s*(\[[\s\S]*?\])\s*[;,\n\r]/);
  if (!tracksMatch) return [];

  try {
    let tracksJson = tracksMatch[1].replace(/\\\//g, '/');
    const tracks = JSON.parse(tracksJson);
    return tracks
      .filter((t: any) => t.file && t.label)
      .map((t: any) => ({ url: t.file, label: t.label }));
  } catch {
    return [];
  }
}
