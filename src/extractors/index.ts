/**
 * Unified extractor dispatcher.
 *
 * Routes embed URLs to the appropriate custom extractor, falling back
 * to the MediaFlow extractor API for unsupported sites.
 *
 * Replaces utils/embedResolver.ts with a cleaner architecture.
 */

import { config } from '../config';
import { buildHlsProxyUrl, buildStreamProxyUrl } from '../utils/mediaflow';
import { db } from '../utils/db';
import { Stream } from '../types';
import type { Extractor, ExtractorResult } from './types';
import { DEFAULT_USER_AGENT } from './utils';

// ── Import all extractors ─────────────────────────────────────────────────────
import dailymotionExtractor, { resolveDailymotionHLS } from './dailymotion';
import okruExtractor from './okru';
import donghuaplanetExtractor from './donghuaplanet';
import streamwishExtractor from './streamwish';
import vidhideExtractor from './vidhide';
import filesimExtractor from './filesim';
import vidmolyExtractor from './vidmoly';
import vtbeExtractor from './vtbe';
import mp4uploadExtractor from './mp4upload';
import bunnycdnExtractor from './bunnycdn';
import vidstackExtractor from './vidstack';
import ultrahdExtractor from './ultrahd';
import playstreamplayExtractor from './playstreamplay';
import mediaflowExtractor from './mediaflow';

/** All registered extractors, ordered by priority (custom first, MediaFlow last) */
const EXTRACTORS: Extractor[] = [
  dailymotionExtractor,
  okruExtractor,
  donghuaplanetExtractor,
  streamwishExtractor,
  vidhideExtractor,
  filesimExtractor,
  vidmolyExtractor,
  vtbeExtractor,
  mp4uploadExtractor,
  bunnycdnExtractor,
  vidstackExtractor,
  ultrahdExtractor,
  playstreamplayExtractor,
  mediaflowExtractor, // Fallback — last resort
];

// ── Public API ────────────────────────────────────────────────────────────────

export interface EmbedResolveOptions {
  /** The originating site URL used as Referer */
  siteUrl: string;
  /** Label shown in Stremio (e.g. "Dark Server", "DM Player") */
  serverLabel: string;
  /** Provider name for logging */
  providerName: string;
  /** User agent used by the provider */
  userAgent?: string;
}

/**
 * Resolve an iframe embed URL to a Stremio-compatible Stream object.
 * Returns null if the embed cannot be resolved.
 */
export async function resolveEmbed(
  embedUrl: string,
  options: EmbedResolveOptions,
): Promise<Stream | null> {
  const { siteUrl, serverLabel, providerName } = options;

  try {
    let hostname = '';
    try {
      hostname = new URL(embedUrl).hostname;
    } catch {
      return null;
    }

    // Check cache first
    const cacheKey = `resolved:${embedUrl}`;
    const cached = db.get(cacheKey) as Stream | null;
    if (cached) {
      console.log(`[${providerName}] Returning cached result for: ${hostname}`);
      return cached;
    }

    // Find matching extractor
    const extractor = EXTRACTORS.find(ex =>
      ex.domains.some(domain => hostname.includes(domain)),
    );

    if (!extractor) {
      console.warn(`[${providerName}] No extractor for domain: ${hostname}, skipping: ${embedUrl}`);
      return null;
    }

    console.log(`[${providerName}] Using extractor: ${extractor.name} for ${hostname}`);

    const results = await extractor.extract(embedUrl, siteUrl);
    if (!results || results.length === 0) {
      console.warn(`[${providerName}] ${extractor.name} returned no results for: ${embedUrl}`);
      return null;
    }

    // Use the best (first) result
    const best = results[0];
    const stream = buildProxiedStream(best, serverLabel, extractor.name, options.userAgent);

    // Cache for 30 minutes
    db.set(cacheKey, stream, 1800);
    return stream;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${providerName}] Embed resolve error for ${embedUrl}: ${msg}`);
    return null;
  }
}

/**
 * Resolve a Dailymotion video ID directly.
 * Used by providers that already know the DM video ID (e.g., DonghuaFun).
 */
export async function resolveDM(
  videoId: string,
  providerName: string,
  userAgent?: string,
): Promise<Stream | null> {
  const resolved = await resolveDailymotionHLS(videoId);
  if (!resolved) {
    console.warn(`[${providerName}] Could not resolve Dailymotion video: ${videoId}`);
    return null;
  }

  return {
    url: buildHlsProxyUrl(resolved.url, {
      referer: resolved.headers?.['Referer'] || 'https://geo.dailymotion.com/',
      origin: resolved.headers?.['Origin'] || 'https://geo.dailymotion.com',
      cookie: resolved.headers?.['Cookie'] || resolved.headers?.['cookie'],
      userAgent,
      maxRes: true,
    }),
    name: `[${resolved.quality}] ${providerName}`,
    description: `Dailymotion · via ${resolved.quality === 'Auto' ? 'Auto' : resolved.quality}`,
  };
}

/**
 * Build a Stream object from a resolved URL with quality and source info.
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
    description: source,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Wrap an extracted result with MediaFlow proxy and build a Stream object.
 */
function buildProxiedStream(
  result: ExtractorResult,
  serverLabel: string,
  extractorName: string,
  userAgent?: string,
): Stream {
  const referer = result.headers?.['Referer'] || result.headers?.['referer'];
  const origin = result.headers?.['Origin'] || result.headers?.['origin'];
  const resolvedUA = result.headers?.['User-Agent'] || result.headers?.['user-agent'] || userAgent;
  const cookie = result.headers?.['Cookie'] || result.headers?.['cookie'];

  let proxyUrl: string;

  if (config.MEDIAFLOW_PROXY_URL) {
    proxyUrl = result.isHls
      ? buildHlsProxyUrl(result.url, { referer, origin, userAgent: resolvedUA, maxRes: true, cookie })
      : buildStreamProxyUrl(result.url, { referer, origin, userAgent: resolvedUA, maxRes: true, cookie });
  } else {
    proxyUrl = result.url;
  }

  const stream: Stream = {
    url: proxyUrl,
    name: `[${result.quality}] ${serverLabel}`,
    description: `${extractorName} · ${result.quality}`,
  };

  // Attach subtitles if present
  if (result.subtitles && result.subtitles.length > 0) {
    (stream as any).subtitles = result.subtitles.map(s => ({
      url: s.url,
      lang: s.label,
    }));
  }

  return stream;
}
