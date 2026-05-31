/**
 * Resolve a Dailymotion video ID to its HLS manifest URL.
 *
 * Dailymotion exposes stream metadata via their embed player JSON endpoint:
 *   https://www.dailymotion.com/player/metadata/video/<ID>
 *
 * The response contains a `qualities` map with HLS URLs per resolution.
 * We pick the highest available (2160 → 1440 → 1080 → 720 → auto).
 */

import axios from 'axios';

const DM_METADATA_URL = 'https://www.dailymotion.com/player/metadata/video/';
const QUALITY_PREFERENCE = ['2160', '1440', '1080', '720', 'auto'];
const MIN_QUALITY = 720; // Filter out streams below this resolution

const DM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://www.dailymotion.com/',
  'Origin': 'https://www.dailymotion.com'
};

export interface DailymotionResult {
  url: string;
  quality: string;
}

/**
 * Resolve a Dailymotion video ID to its best HLS manifest URL.
 */
export async function resolveDailymotionHLS(videoId: string): Promise<DailymotionResult | null> {
  const metaUrl = `${DM_METADATA_URL}${videoId}`;

  try {
    const res = await axios.get(metaUrl, {
      headers: DM_HEADERS,
      timeout: 15000,
      validateStatus: (status) => status < 500 // Accept 404 and other 4xx errors
    });

    const data = res.data;

    // Handle geo-restricted or error responses containing the real video ID
    if (data && data.error) {
      let realVideoId = videoId;
      if (data.id) {
        realVideoId = data.id;
      } else if (data.url) {
        const realMatch = data.url.match(/\/video\/([kx][a-zA-Z0-9]+)/);
        if (realMatch) realVideoId = realMatch[1];
      }

      if (realVideoId !== videoId) {
        console.log(`[Dailymotion] Found real ID ${realVideoId} from error response, retrying...`);
        return resolveDailymotionHLS(realVideoId);
      }
    }

    // qualities object: { "1080": [{type:"application/x-mpegURL", url:"..."}], ... }
    const qualities = data && data.qualities;
    if (!qualities) {
      console.error(`[Dailymotion] No qualities in metadata for ${videoId}`);
      return null;
    }

    // First pass: find the best specific quality (non-auto) at or above MIN_QUALITY
    let bestSpecific: DailymotionResult | null = null;
    for (const q of QUALITY_PREFERENCE) {
      if (q === 'auto') continue;
      const qNum = parseInt(q);
      if (qNum < MIN_QUALITY) continue; // Skip sub-720p

      const entries = qualities[q];
      if (!entries || !entries.length) continue;

      const hls = entries.find((e: any) =>
        e.type === 'application/x-mpegURL' || (e.url && e.url.includes('.m3u8'))
      );
      const mp4 = entries.find((e: any) =>
        e.type === 'video/mp4' || (e.url && e.url.includes('.mp4'))
      );
      const chosen = hls || mp4;

      if (chosen && chosen.url) {
        bestSpecific = { url: chosen.url, quality: `${q}p` };
        break; // Already sorted by preference, first match is best
      }
    }

    if (bestSpecific) return bestSpecific;

    // Fallback: use 'auto' master manifest (adaptive bitrate)
    // MediaFlow with max_res=true will automatically select the highest variant
    const autoEntries = qualities['auto'];
    if (autoEntries && autoEntries.length) {
      const hls = autoEntries.find((e: any) =>
        e.type === 'application/x-mpegURL' || (e.url && e.url.includes('.m3u8'))
      );
      if (hls && hls.url) {
        // Determine the best label: check what specific qualities exist
        const availableQualities = Object.keys(qualities)
          .filter(k => k !== 'auto' && parseInt(k) >= MIN_QUALITY)
          .map(k => parseInt(k))
          .sort((a, b) => b - a);
        const bestLabel = availableQualities.length > 0
          ? `${availableQualities[0]}p`
          : '720p+'; // Conservative label when unknown
        return { url: hls.url, quality: bestLabel };
      }
    }

    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Dailymotion] Metadata fetch failed for ${videoId}: ${message}`);
    return null;
  }
}
