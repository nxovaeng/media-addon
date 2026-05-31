/**
 * Shared embed resolver for MediaFlow extractors.
 *
 * This module only handles video extractors supported by MediaFlow Proxy Light:
 * https://mhdzumair.github.io/mediaflow-proxy-light/features/
 *
 * Other embed sources (VidLink, DonghuaPlanet, Rumble, Dailymotion) should be
 * handled directly by their respective providers for better performance.
 */

import { resolveDailymotionHLS } from './dailymotion';
import { resolveDonghuaPlanet } from './donghuaplanet';
import { buildHlsProxyUrl, buildStreamProxyUrl, resolveViaMediaflowExtractor } from './mediaflow';
import { Stream } from '../types';
import { db } from './db';

const EXTRACTOR_MAP: Record<string, string> = {
  // MediaFlow Proxy Light - 24 Video Extractors
  // https://mhdzumair.github.io/mediaflow-proxy-light/features/
  'city': 'city',
  'dood': 'doodstream',
  'f16px': 'f16px',
  'fastream': 'fastream',
  'filelions': 'filelions',
  'filemoon': 'filemoon',
  'gupload': 'gupload',
  'livetv': 'livetv',
  'lulustream': 'lulustream',
  'maxstream': 'maxstream',
  'mixdrop': 'mixdrop',
  'ok.ru': 'okru',
  'odnoklassniki.ru': 'okru',
  'sportsonline': 'sportsonline',
  'streamtape': 'streamtape',
  'streamwish': 'streamwish',
  'supervideo': 'supervideo',
  'turbovidplay': 'turbovidplay',
  'uqload': 'uqload',
  'vavoo': 'vavoo',
  'vidfast': 'vidfast',
  'vidmoly': 'vidmoly',
  'vidoza': 'vidoza',
  'vixcloud': 'vixcloud',
  'voe': 'voe',
};

export interface EmbedResolveOptions {
  /** The originating site URL used as Referer */
  siteUrl: string;
  /** Label shown in Stremio (e.g. "Dark Server", "DM Player") */
  serverLabel: string;
  /** Provider name for logging */
  providerName: string;
  /** User agent used by the provider when resolving this embed */
  userAgent?: string;
}

/**
 * Resolve an iframe embed URL to a Stremio-compatible Stream object.
 * Returns null if the embed cannot be resolved.
 */
export async function resolveEmbed(
  embedUrl: string,
  options: EmbedResolveOptions
): Promise<Stream | null> {
  const { siteUrl, serverLabel, providerName } = options;

  try {
    // ── Dailymotion (standard embed) ─────────────────────────────────────
    const dmMatch = embedUrl.match(/dailymotion\.com\/embed\/video\/([a-zA-Z0-9]+)/);
    if (dmMatch) {
      return resolveDM(dmMatch[1], providerName, options.userAgent);
    }

    // ── Dailymotion (geo player: geo.dailymotion.com/player/xxx?video=YYY) ─
    const geoMatch = embedUrl.match(/geo\.dailymotion\.com\/player\/[^?]+\?.*video=([a-zA-Z0-9]+)/);
    if (geoMatch) {
      return resolveDM(geoMatch[1], providerName, options.userAgent);
    }

    // ── Rumble direct embed (rumble.com/embed/xxx) ───────────────────────
    if (embedUrl.includes('rumble.com/embed/')) {
      const resolved = await resolveDonghuaPlanet(embedUrl, siteUrl);
      if (!resolved) {
        console.warn(`[${providerName}] Could not resolve Rumble embed: ${embedUrl}`);
        return null;
      }
      return buildStreamResult(resolved, embedUrl, serverLabel, 'Rumble', options.userAgent);
    }

    // ── DonghuaPlanet (Rumble-based JWPlayer) ────────────────────────────
    if (embedUrl.includes('donghuaplanet.com') || embedUrl.includes('playdaku.com')) {
      const resolved = await resolveDonghuaPlanet(embedUrl, siteUrl);
      if (!resolved) {
        console.warn(`[${providerName}] Could not resolve DonghuaPlanet embed: ${embedUrl}`);
        return null;
      }
      return buildStreamResult(resolved, embedUrl, serverLabel, 'Rumble', options.userAgent);
    }

    // ── MediaFlow Extractor integration ────────────────────────────────────
    let hostname = '';
    try {
      hostname = new URL(embedUrl).hostname;
    } catch (e) {
      return null;
    }

    // Check if this hostname is supported by MediaFlow extractors
    const matchedKey = Object.keys(EXTRACTOR_MAP).find(key => hostname.includes(key));
    if (!matchedKey) {
      // Not a supported extractor host - let provider handle it directly
      console.warn(`[${providerName}] Unknown embed domain, skipping: ${embedUrl}`);
      return null;
    }

    const cacheKey = `resolved:${embedUrl}`;
    const cached = db.get(cacheKey) as Stream | null;
    if (cached) {
      console.log(`[${providerName}] Returning cached extractor result for: ${hostname}`);
      return cached;
    }

    const extractorName = EXTRACTOR_MAP[matchedKey];
    const extracted = await resolveViaMediaflowExtractor(extractorName, embedUrl);
    if (extracted) {
      const stream = buildExtractorStreamResult(extracted, embedUrl, serverLabel, matchedKey, options.userAgent);
      db.set(cacheKey, stream, 1800); // Cache for 30 minutes
      return stream;
    }

    // ── extractor failed ─────────────────────────────────────────────
    console.warn(`[${providerName}] extractor failed for ${embedUrl}`);
    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${providerName}] Embed resolve error for ${embedUrl}: ${message}`);
    return null;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

export async function resolveDM(videoId: string, providerName: string, userAgent?: string): Promise<Stream | null> {
  const resolved = await resolveDailymotionHLS(videoId);
  if (!resolved) {
    console.warn(`[${providerName}] Could not resolve Dailymotion video: ${videoId}`);
    return null;
  }
  return {
    url: buildHlsProxyUrl(resolved.url, {
      referer: 'https://geo.dailymotion.com/',
      origin: 'https://geo.dailymotion.com',
      userAgent,
      maxRes: true,
    }),
    name: `[${resolved.quality}] ${providerName}`,
    description: `Dailymotion · via MediaFlow`,
  };
}

function buildStreamResult(
  resolved: { url: string; quality: string },
  embedUrl: string,
  serverLabel: string,
  source: string,
  userAgent?: string,
): Stream {
  const isHls = resolved.url.includes('.m3u8');
  const proxyUrl = isHls
    ? buildHlsProxyUrl(resolved.url, {
      referer: embedUrl,
      origin: new URL(embedUrl).origin,
      userAgent,
      maxRes: true,
    })
    : buildStreamProxyUrl(resolved.url, {
      referer: embedUrl,
      origin: new URL(embedUrl).origin,
      userAgent,
      maxRes: true,
    });

  return {
    url: proxyUrl,
    name: `[${resolved.quality}] ${serverLabel}`,
    description: `${source} · via MediaFlow`,
  };
}

/**
 * Build a stream result from extracted URL and metadata.
 * Internal helper for MediaFlow extractor results.
 */
function buildExtractorStreamResult(
  extracted: { url: string; headers?: Record<string, string>; is_hls?: boolean },
  embedUrl: string,
  serverLabel: string,
  source: string,
  userAgent?: string,
): Stream {
  const isHls = extracted.is_hls ?? extracted.url.includes('.m3u8');

  // Extract custom headers
  const referer = extracted.headers?.['Referer'] || extracted.headers?.['referer'] || embedUrl;
  const resolvedUserAgent = extracted.headers?.['User-Agent'] || extracted.headers?.['user-agent'] || userAgent;
  const origin = extracted.headers?.['Origin'] || extracted.headers?.['origin'] || new URL(embedUrl).origin;

  const proxyUrl = isHls
    ? buildHlsProxyUrl(extracted.url, { referer, origin, userAgent: resolvedUserAgent, maxRes: true })
    : buildStreamProxyUrl(extracted.url, { referer, origin, userAgent: resolvedUserAgent });

  return {
    url: proxyUrl,
    name: `[Auto] ${serverLabel}`,
    description: `${source.charAt(0).toUpperCase() + source.slice(1)} · via MediaFlow Extractor`,
  };
}

/**
 * Build a stream object from a resolved URL with quality and source info.
 * Used by providers that handle their own embed resolution.
 */
export function buildStreamFromResolved(
  resolved: { url: string; quality: string },
  embedUrl: string,
  serverLabel: string,
  source: string,
  userAgent?: string,
): Stream {
  const isHls = resolved.url.includes('.m3u8');
  const proxyUrl = isHls
    ? buildHlsProxyUrl(resolved.url, {
      referer: embedUrl,
      origin: new URL(embedUrl).origin,
      userAgent,
      maxRes: true,
    })
    : buildStreamProxyUrl(resolved.url, {
      referer: embedUrl,
      origin: new URL(embedUrl).origin,
      userAgent,
      maxRes: true,
    });

  return {
    url: proxyUrl,
    name: `[${resolved.quality}] ${serverLabel}`,
    description: `${source}`,
  };
}
