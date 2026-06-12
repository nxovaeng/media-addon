/**
 * Shared utilities for video extractors.
 *
 * Provides: HTTP fetching, Dean Edwards JS unpacker, constants.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

export { cheerio };

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

/**
 * Fetch a page's HTML content with appropriate headers.
 */
export async function fetchPage(
  url: string,
  referer?: string,
  extraHeaders?: Record<string, string>,
): Promise<string | null> {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Referer': referer || new URL(url).origin + '/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...extraHeaders,
      },
      timeout: 15000,
      responseType: 'text',
    });
    return typeof res.data === 'string' ? res.data : String(res.data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Extractor] fetchPage failed for ${url}: ${msg}`);
    return null;
  }
}

/**
 * Fetch JSON from a URL.
 */
export async function fetchJson(url: string, referer?: string): Promise<any | null> {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Referer': referer || new URL(url).origin + '/',
        'Accept': 'application/json, */*',
      },
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Extractor] fetchJson failed for ${url}: ${msg}`);
    return null;
  }
}

// ── Dean Edwards JS Packer / Unpacker ─────────────────────────────────────────
// Ported from JavaScriptUnpacker used by CloudStream and similar projects.
// Handles: eval(function(p,a,c,k,e,d){...}('packed_string', base, count, keywords, 0, {}))

/**
 * Detect whether HTML contains packed JavaScript.
 */
export function detectPacked(html: string): boolean {
  return /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/.test(html);
}

/**
 * Find and unpack all packed JS blocks in the HTML.
 * Returns the concatenated unpacked code.
 */
export function getAndUnpack(html: string): string {
  const packedRegex = /eval\(function\(p,a,c,k,e,[dr]\)\{.*?\}\('(.*?)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\.split\('\|'\)\s*,\s*\d+\s*,\s*\{?\}?\s*\)\)/gs;
  const results: string[] = [];
  let match;

  while ((match = packedRegex.exec(html)) !== null) {
    try {
      const unpacked = unpack(match[1], parseInt(match[2]), parseInt(match[3]), match[4].split('|'));
      if (unpacked) results.push(unpacked);
    } catch {
      // Skip malformed packed blocks
    }
  }

  if (results.length > 0) return results.join('\n');

  // Fallback: try a more lenient regex
  const fallbackRegex = /eval\(function\(p,a,c,k,e,[dr]\)\{.*?\}(\(.*?\))\)/gs;
  while ((match = fallbackRegex.exec(html)) !== null) {
    try {
      const args = extractPackedArgs(match[1]);
      if (args) {
        const unpacked = unpack(args.payload, args.base, args.count, args.keywords);
        if (unpacked) results.push(unpacked);
      }
    } catch {
      // Skip
    }
  }

  return results.join('\n') || html;
}

/**
 * Unpack a single packed JS block.
 */
export function unpack(payload: string, base: number, _count: number, keywords: string[]): string {
  // Replace each base-N encoded token with the corresponding keyword
  return payload.replace(/\b\w+\b/g, (word) => {
    const n = unbaser(word, base);
    return (n < keywords.length && keywords[n] !== '') ? keywords[n] : word;
  });
}

/**
 * Convert a word from a given base to a number.
 * Supports bases up to 62 (0-9, a-z, A-Z).
 */
function unbaser(word: string, base: number): number {
  const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (base <= 36) {
    return parseInt(word, base);
  }

  let result = 0;
  for (let i = 0; i < word.length; i++) {
    const char = word[i];
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) return NaN;
    result = result * base + idx;
  }
  return result;
}

/**
 * Extract arguments from a packed JS call string: ('payload', base, count, 'kw1|kw2|...'.split('|'), 0, {})
 */
function extractPackedArgs(argsStr: string): { payload: string; base: number; count: number; keywords: string[] } | null {
  // Match: ('payload', base, count, 'keywords'.split('|'), ...)
  const m = argsStr.match(/\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.split\s*\(\s*'\|'\s*\)/);
  if (!m) return null;
  return {
    payload: m[1].replace(/\\'/g, "'"),
    base: parseInt(m[2]),
    count: parseInt(m[3]),
    keywords: m[4].split('|'),
  };
}
