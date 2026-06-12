/**
 * HLS Master Playlist Resolver.
 *
 * Fetches an HLS master manifest (m3u8), parses variant streams,
 * and returns the best variant URL locked to a specific resolution.
 *
 * This prevents players from auto-switching to low resolution.
 */

import axios from 'axios';
import { DEFAULT_USER_AGENT } from './utils';

export interface HlsVariant {
  url: string;
  width: number;
  height: number;
  bandwidth: number;
}

export interface HlsResolveOptions {
  /** Headers to use when fetching the m3u8 */
  headers?: Record<string, string>;
  /** Minimum acceptable resolution height (default: 720) */
  minResolution?: number;
}

/**
 * Fetch and parse an HLS master playlist, returning the best variant.
 *
 * If the URL is not a master playlist (no #EXT-X-STREAM-INF), returns null.
 * If fetching or parsing fails, returns null (caller should fallback to original URL).
 */
export async function resolveHlsBestVariant(
  m3u8Url: string,
  options: HlsResolveOptions = {},
): Promise<HlsVariant | null> {
  const minRes = options.minResolution ?? 720;

  try {
    const res = await axios.get(m3u8Url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        ...options.headers,
      },
      timeout: 10000,
      responseType: 'text',
    });

    const content = typeof res.data === 'string' ? res.data : String(res.data);

    // Check if this is a master playlist (contains #EXT-X-STREAM-INF)
    if (!content.includes('#EXT-X-STREAM-INF')) {
      return null; // Media playlist, not a master playlist
    }

    const variants = parseVariants(content, m3u8Url);
    if (variants.length === 0) return null;

    // Filter by minimum resolution, then sort by height descending
    const filtered = variants.filter(v => v.height >= minRes);

    // If no variants meet minimum, use all variants (prefer some stream over none)
    const candidates = filtered.length > 0 ? filtered : variants;
    candidates.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);

    const best = candidates[0];
    console.log(
      `[HLS] Resolved variant: ${best.width}x${best.height} (BANDWIDTH=${best.bandwidth}) ` +
      `from ${variants.length} variant(s), ${filtered.length} above ${minRes}p`,
    );

    return best;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[HLS] Failed to resolve variants for ${m3u8Url}: ${msg}`);
    return null;
  }
}

/**
 * Parse #EXT-X-STREAM-INF lines and their following URLs from m3u8 content.
 */
function parseVariants(content: string, baseUrl: string): HlsVariant[] {
  const variants: HlsVariant[] = [];
  const lines = content.split('\n').map(l => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    // Extract attributes
    const attrs = line.slice('#EXT-X-STREAM-INF:'.length);

    // Parse RESOLUTION=WxH
    const resMatch = attrs.match(/RESOLUTION=(\d+)x(\d+)/);
    const width = resMatch ? parseInt(resMatch[1]) : 0;
    const height = resMatch ? parseInt(resMatch[2]) : 0;

    // Parse BANDWIDTH
    const bwMatch = attrs.match(/BANDWIDTH=(\d+)/);
    const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;

    // Next non-empty, non-comment line is the variant URL
    let variantUrl = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] && !lines[j].startsWith('#')) {
        variantUrl = lines[j];
        break;
      }
    }

    if (!variantUrl) continue;

    // Strip URL fragments (#)
    if (variantUrl.includes('#')) {
      variantUrl = variantUrl.split('#')[0];
    }

    // Resolve relative URL to absolute
    const absoluteUrl = resolveUrl(variantUrl, baseUrl);

    variants.push({ url: absoluteUrl, width, height, bandwidth });
  }

  return variants;
}

/**
 * Resolve a possibly-relative URL against a base URL.
 */
function resolveUrl(url: string, base: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  try {
    return new URL(url, base).toString();
  } catch {
    // Manual fallback for edge cases
    if (url.startsWith('/')) {
      const origin = new URL(base).origin;
      return origin + url;
    }
    const lastSlash = base.lastIndexOf('/');
    return base.slice(0, lastSlash + 1) + url;
  }
}
