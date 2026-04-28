import axios from 'axios';
import * as cheerio from 'cheerio';
import { Provider, MediaItem, Stream, Subtitle } from '../types';
import { db } from '../utils/db';
import { buildHlsProxyUrl } from '../utils/mediaflow';

const SITE_CONFIG = {
  id: 'cinemacity',
  name: 'CinemaCity',
  baseUrl: 'https://cinemacity.cc',
  // Decoded from ZGxlX3VzZXJfaWQ9MzI3Mjk7IGRsZV9wYXNzd29yZD04OTQxNzFjNmE4ZGFiMThlZTU5NGQ1YzY1MjAwOWEzNTs=
  cookie: 'dle_user_id=32729; dle_password=894171c6a8dab18ee594d5c652009a35;',
};

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Cookie': SITE_CONFIG.cookie,
};

const cinemacityProvider: Provider = {
  id: SITE_CONFIG.id,
  name: SITE_CONFIG.name,
  enabled: true,
  weight: 70,

  async getStreams(item: MediaItem): Promise<Stream[]> {
    const title = item.title || item.name || '';
    if (!title) return [];

    const cacheKey = `resolved:cinemacity:${item.id}:${item.season || 0}:${item.episode || 0}`;
    const cached = db.get(cacheKey) as Stream[] | null;
    if (cached) return cached;

    try {
      console.log(`[CinemaCity] Searching for: ${title}`);
      
      // 1. Search for the item
      const searchUrl = `${SITE_CONFIG.baseUrl}/?do=search&subaction=search&search_start=0&full_search=0&story=${encodeURIComponent(title)}`;
      const searchRes = await axios.get(searchUrl, { headers: DEFAULT_HEADERS, timeout: 15000 });
      const $search = cheerio.load(searchRes.data);
      
      let detailUrl: string | undefined;
      $search('div.dar-short_item').each((_, el) => {
        const titleText = $search(el).find('a').first().text();
        const title = titleText.split('(')[0].trim();
        
        const targetTitle = item.title || item.name || '';
        // Simple title matching
        if (targetTitle && title.toLowerCase() === targetTitle.toLowerCase()) {
          detailUrl = $search(el).find('a').first().attr('href');
          return false;
        }
      });

      if (!detailUrl) {
        // Try fallback search if exact match fails
        detailUrl = $search('div.dar-short_item a').first().attr('href');
      }

      if (!detailUrl) {
        console.warn(`[CinemaCity] No search results for: ${item.title}`);
        return [];
      }
      if (!detailUrl.startsWith('http')) detailUrl = `${SITE_CONFIG.baseUrl}${detailUrl}`;

      // 2. Load detail page
      console.log(`[CinemaCity] Loading detail page: ${detailUrl}`);
      const detailRes = await axios.get(detailUrl, { headers: DEFAULT_HEADERS, timeout: 15000 });
      const $detail = cheerio.load(detailRes.data);

      // 3. Extract Playerjs config from scripts containing "atob"
      let base64Match: RegExpMatchArray | null = null;
      $detail('script').each((_, el) => {
        const scriptContent = $detail(el).html() || '';
        if (scriptContent.includes('atob(')) {
          const match = scriptContent.match(/atob\("([^"]+)"\)/);
          if (match) {
            base64Match = match;
            return false;
          }
        }
      });

      if (!base64Match) {
        console.warn(`[CinemaCity] Could not find player config on page`);
        return [];
      }

      // 4. Parse file JSON and Subtitles
      let fileData: any;
      let rawSubtitles: string | undefined;
      try {
        const decoded = Buffer.from(base64Match[1], 'base64').toString('utf-8');
        const jsonMatch = decoded.match(/new Playerjs\((.*)\);/s);
        if (jsonMatch) {
            // Use simple regex to extract properties since it's not pure JSON
            const fileMatch = jsonMatch[1].match(/"?file"?\s*:\s*(['"\[\{].*?['"\]\}])\s*[,}]/s);
            const subMatch = jsonMatch[1].match(/"?subtitle"?\s*:\s*(['"].*?['"])\s*[,}]/s);
            
            if (fileMatch) {
                let fileStr = fileMatch[1].trim();
                if ((fileStr.startsWith("'") && fileStr.endsWith("'")) || (fileStr.startsWith('"') && fileStr.endsWith('"'))) {
                    fileStr = fileStr.substring(1, fileStr.length - 1);
                }
                
                if (fileStr.startsWith('[') || fileStr.startsWith('{')) {
                    fileData = JSON.parse(fileStr);
                } else {
                    fileData = [{ file: fileStr }];
                }
            }
            
            if (subMatch) {
                rawSubtitles = subMatch[1].trim();
                if ((rawSubtitles.startsWith("'") && rawSubtitles.endsWith("'")) || (rawSubtitles.startsWith('"') && rawSubtitles.endsWith('"'))) {
                    rawSubtitles = rawSubtitles.substring(1, rawSubtitles.length - 1);
                }
            }
        }
      } catch (err) {
        return [];
      }

      if (!fileData) return [];

      const streams: Stream[] = [];
      const subtitles = rawSubtitles ? parseSubtitles(rawSubtitles) : undefined;
      
      // 5. Extract specific stream based on type
      if (item.type === 'movie') {
        const file = Array.isArray(fileData) ? fileData[0]?.file : fileData.file;
        const movieSub = Array.isArray(fileData) ? (fileData[0]?.subtitle || rawSubtitles) : rawSubtitles;
        const subs = movieSub ? parseSubtitles(movieSub) : subtitles;

        if (file && typeof file === 'string') {
          streams.push(buildStream(file, subs));
        }
      } else {
        // TV Series
        const seasonNum = item.season || 1;
        const episodeNum = item.episode || 1;
        const seasonRegex = new RegExp(`Season\\s*${seasonNum}`, 'i');
        const episodeRegex = new RegExp(`Episode\\s*${episodeNum}`, 'i');
        
        const season = Array.isArray(fileData) ? fileData.find((s: any) => seasonRegex.test(s.title)) : null;
        if (season && season.folder) {
            const episode = season.folder.find((e: any) => episodeRegex.test(e.title));
            if (episode && episode.file) {
                const epSub = episode.subtitle || rawSubtitles;
                const subs = epSub ? parseSubtitles(epSub) : subtitles;
                streams.push(buildStream(episode.file, subs));
            }
        }
      }

      if (streams.length > 0) {
        db.set(cacheKey, streams, 3600);
      }
      return streams;

    } catch (err) {
      console.error(`[CinemaCity] getStreams failed:`, err instanceof Error ? err.message : String(err));
      return [];
    }
  }
};

function parseSubtitles(raw: string): Subtitle[] {
    const tracks: Subtitle[] = [];
    if (!raw) return tracks;

    // Pattern: [En]https://... or just https://...
    raw.split(',').forEach(entry => {
        const match = entry.trim().match(/\[(.+?)\](https?:\/\/.+)/);
        if (match) {
            tracks.push({ 
                id: match[2], // Required field
                lang: match[1], 
                url: match[2] 
            });
        } else if (entry.trim().startsWith('http')) {
            const url = entry.trim();
            tracks.push({ 
                id: url, // Required field
                lang: 'Unknown', 
                url: url 
            });
        }
    });
    return tracks;
}

function buildStream(url: string, subtitles?: any[]): Stream {
  return {
    url: buildHlsProxyUrl(url, {
        referer: SITE_CONFIG.baseUrl + '/',
        origin: SITE_CONFIG.baseUrl,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }),
    name: `[Auto] ${SITE_CONFIG.name}`,
    description: 'Cinemacity · HLS',
    subtitles
  };
}

export default cinemacityProvider;
