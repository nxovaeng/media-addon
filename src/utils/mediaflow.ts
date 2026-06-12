/**
 * MediaFlow Proxy URL builder.
 *
 * Supports two proxy modes matching the MediaFlow Proxy standard API:
 *   1. HLS manifest proxy:  /proxy/hls/manifest.m3u8?d=<url>&h_referer=...
 *   2. Generic stream proxy: /proxy/stream?d=<url>&h_referer=...
 *
 * Video extraction logic has been moved to src/extractors/.
 */

import { config } from '../config';

export interface MediaFlowOptions {
  referer?: string;
  origin?: string;
  userAgent?: string;
  cookie?: string;
  maxRes?: boolean;
}

/**
 * Build a MediaFlow HLS proxy URL for a Dailymotion-style HLS manifest.
 */
export function buildHlsProxyUrl(hlsManifestUrl: string, options: MediaFlowOptions = {}): string {
  if (!config.MEDIAFLOW_PROXY_URL) {
    return hlsManifestUrl;
  }

  const params = new URLSearchParams({
    d: hlsManifestUrl,
  });

  if (options.referer) params.set('h_referer', options.referer);
  if (options.origin) params.set('h_origin', options.origin);
  if (options.userAgent) params.set('h_user-agent', options.userAgent);
  if (options.cookie) params.set('h_cookie', options.cookie);
  if (options.maxRes) params.set('max_res', 'true');
  if (config.MEDIAFLOW_API_PASSWORD) params.set('api_password', config.MEDIAFLOW_API_PASSWORD);

  return `${config.MEDIAFLOW_PROXY_URL}/proxy/hls/manifest.m3u8?${params.toString()}`;
}

/**
 * Build a MediaFlow generic stream proxy URL.
 * Used for direct video URLs that need header injection (Referer, etc).
 */
export function buildStreamProxyUrl(targetUrl: string, options: MediaFlowOptions = {}): string {
  if (!config.MEDIAFLOW_PROXY_URL) {
    return targetUrl;
  }

  const params = new URLSearchParams({
    d: targetUrl,
  });

  if (options.referer) params.set('h_referer', options.referer);
  if (options.origin) params.set('h_origin', options.origin);
  if (options.userAgent) params.set('h_user-agent', options.userAgent);
  if (options.cookie) params.set('h_cookie', options.cookie);
  if (options.maxRes) params.set('max_res', 'true');
  if (config.MEDIAFLOW_API_PASSWORD) params.set('api_password', config.MEDIAFLOW_API_PASSWORD);

  return `${config.MEDIAFLOW_PROXY_URL}/proxy/stream?${params.toString()}`;
}

/**
 * Legacy wrapper: wrap a URL with custom headers through the stream proxy.
 * Kept for backward compatibility with existing providers.
 */
export function wrapProxyUrl(targetUrl: string, headers: Record<string, string> = {}): string {
  return buildStreamProxyUrl(targetUrl, {
    referer: headers['Referer'] || headers['referer'],
    origin: headers['Origin'] || headers['origin'],
    userAgent: headers['User-Agent'] || headers['user-agent'],
    maxRes: true,
  });
}
