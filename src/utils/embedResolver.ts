/**
 * Shared embed resolver for donghua sites (donghuaworld, donghuastream, animekhor).
 *
 * Classifies iframe embed URLs by domain and resolves them to real
 * playable video URLs via the appropriate resolver.
 */

import { resolveDailymotionHLS } from './dailymotion';
import { resolveDonghuaPlanet } from './donghuaplanet';
// import { resolveOkRu } from './okru';  // 绑定ip 屏蔽了
import { buildHlsProxyUrl, buildStreamProxyUrl, resolveViaMediaflowExtractor } from './mediaflow';
import { Stream } from '../types';
import { config } from '../config';
import { db } from './db';

const EXTRACTOR_MAP: Record<string, string> = {
  'dood': 'doodstream', // Handles dood.watch, doodstream.com, etc
  'filelions': 'filelions',
  'mixdrop': 'mixdrop',
  'streamtape': 'streamtape',
  'vidoza': 'vidoza',
  'streamwish': 'streamwish',
  'lulustream': 'lulustream',
  'turbovidplay': 'turbovidplay',
  'maxstream': 'maxstream',
  'uqload': 'uqload',
  'ok.ru': 'okru', // IMPORTANT: Maps ok.ru to the 'okru' extractor
  'voe': 'voe',
  'vidmoly': 'vidmoly',
  'vidlink': 'vidlink',
  'vidlink.pro': 'vidlink',
  'supervideo': 'supervideo',
  'mp4upload': 'mp4upload'
};

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface EmbedResolveOptions {
  /** The originating site URL used as Referer */
  siteUrl: string;
  /** Label shown in Stremio (e.g. "Dark Server", "DM Player") */
  serverLabel: string;
  /** Provider name for logging */
  providerName: string;
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
      return resolveDM(dmMatch[1], serverLabel, providerName);
    }

    // ── Dailymotion (geo player: geo.dailymotion.com/player/xxx?video=YYY) ─
    const geoMatch = embedUrl.match(/geo\.dailymotion\.com\/player\/[^?]+\?.*video=([a-zA-Z0-9]+)/);
    if (geoMatch) {
      return resolveDM(geoMatch[1], serverLabel, providerName);
    }

    // ── Rumble direct embed (rumble.com/embed/xxx) ───────────────────────
    if (embedUrl.includes('rumble.com/embed/')) {
      const resolved = await resolveDonghuaPlanet(embedUrl, siteUrl);
      if (!resolved) {
        console.warn(`[${providerName}] Could not resolve Rumble embed: ${embedUrl}`);
        return null;
      }
      return buildStreamResult(resolved, embedUrl, serverLabel, 'Rumble');
    }

    // ── DonghuaPlanet (Rumble-based JWPlayer) ────────────────────────────
    if (embedUrl.includes('donghuaplanet.com') || embedUrl.includes('playdaku.com')) {
      const resolved = await resolveDonghuaPlanet(embedUrl, siteUrl);
      if (!resolved) {
        console.warn(`[${providerName}] Could not resolve DonghuaPlanet embed: ${embedUrl}`);
        return null;
      }
      return buildStreamResult(resolved, embedUrl, serverLabel, 'Rumble');
    }

    // ── MediaFlow Extractor integration ────────────────────────────────────
    let hostname = '';
    try {
      hostname = new URL(embedUrl).hostname;
    } catch (e) { }

    const matchedKey = Object.keys(EXTRACTOR_MAP).find(key => hostname.includes(key));
    if (matchedKey) {
      const cacheKey = `resolved:${embedUrl}`;
      const cached = db.get(cacheKey) as Stream | null;
      if (cached) {
        console.log(`[${providerName}] Returning cached extractor result for: ${hostname}`);
        return cached;
      }

      const extractorName = EXTRACTOR_MAP[matchedKey];
      const extracted = await resolveViaMediaflowExtractor(extractorName, embedUrl);
      if (extracted) {
        const stream = buildExtractorStreamResult(extracted, embedUrl, serverLabel, matchedKey);
        db.set(cacheKey, stream, 1800); // Cache for 30 minutes
        return stream;
      }
    }

    // ── Unknown embed — skip ─────────────────────────────────────────────
    console.warn(`[${providerName}] Unknown embed domain, skipping: ${embedUrl}`);
    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${providerName}] Embed resolve error for ${embedUrl}: ${message}`);
    return null;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function resolveDM(videoId: string, serverLabel: string, providerName: string): Promise<Stream | null> {
  const resolved = await resolveDailymotionHLS(videoId);
  if (!resolved) {
    console.warn(`[${providerName}] Could not resolve Dailymotion video: ${videoId}`);
    return null;
  }
  return {
    url: buildHlsProxyUrl(resolved.url, {
      referer: 'https://www.dailymotion.com/',
      origin: 'https://www.dailymotion.com',
      userAgent: DEFAULT_USER_AGENT,
      maxRes: true,
    }),
    name: `[${resolved.quality}] ${serverLabel}`,
    description: `Dailymotion · via MediaFlow`,
  };
}

function buildStreamResult(
  resolved: { url: string; quality: string },
  embedUrl: string,
  serverLabel: string,
  source: string,
): Stream {
  const isHls = resolved.url.includes('.m3u8');
  const proxyUrl = isHls
    ? buildHlsProxyUrl(resolved.url, {
      referer: embedUrl,
      origin: new URL(embedUrl).origin,
      userAgent: DEFAULT_USER_AGENT,
    })
    : buildStreamProxyUrl(resolved.url, {
      referer: embedUrl,
      origin: new URL(embedUrl).origin,
      userAgent: DEFAULT_USER_AGENT,
    });

  return {
    url: proxyUrl,
    name: `[${resolved.quality}] ${serverLabel}`,
    description: `${source} · via MediaFlow`,
  };
}

function buildExtractorStreamResult(
  extracted: { url: string; headers?: Record<string, string>; is_hls?: boolean },
  embedUrl: string,
  serverLabel: string,
  source: string,
): Stream {
  const isHls = extracted.is_hls ?? extracted.url.includes('.m3u8');

  // Extract custom headers
  const referer = extracted.headers?.['Referer'] || extracted.headers?.['referer'] || embedUrl;
  const userAgent = extracted.headers?.['User-Agent'] || extracted.headers?.['user-agent'] || DEFAULT_USER_AGENT;
  const origin = extracted.headers?.['Origin'] || extracted.headers?.['origin'] || new URL(embedUrl).origin;

  const proxyUrl = isHls
    ? buildHlsProxyUrl(extracted.url, { referer, origin, userAgent })
    : buildStreamProxyUrl(extracted.url, { referer, origin, userAgent });

  return {
    url: proxyUrl,
    name: `[Auto] ${serverLabel}`,
    description: `${source.charAt(0).toUpperCase() + source.slice(1)} · via MediaFlow Extractor`,
  };
}
