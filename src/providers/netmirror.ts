import axios from 'axios';
import * as cheerio from 'cheerio';
import { Provider, MediaItem, Stream, Meta } from '../types';
import { db } from '../utils/db';
import { buildHlsProxyUrl } from '../utils/mediaflow';

const SITE_CONFIG = {
    id: 'netmirror',
    name: 'NetMirror',
    mainUrl: 'https://net22.cc',
    playerUrl: 'https://net52.cc',
};

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Android) ExoPlayer',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': SITE_CONFIG.mainUrl + '/'
};

interface NetMirrorBypass {
    t_hash_t: string;
}

/**
 * Perform the "Bypass" logic to get a valid t_hash_t cookie.
 */
async function getBypassCookie(): Promise<string | null> {
    const cacheKey = 'netmirror:bypass';
    const cached = db.get(cacheKey) as string;
    if (cached) return cached;

    try {
        let cookie = '';
        // The original extension polls p.php multiple times until r: "n"
        for (let i = 0; i < 5; i++) {
            const res = await axios.post(`${SITE_CONFIG.mainUrl}/tv/p.php`, {}, {
                headers: DEFAULT_HEADERS,
                timeout: 5000
            });
            
            // Extract t_hash_t from Set-Cookie header
            const setCookie = res.headers['set-cookie'];
            if (setCookie) {
                const match = setCookie.join(';').match(/t_hash_t=([^;]+)/);
                if (match) cookie = match[1];
            }

            if (res.data && res.data.r === 'n' && cookie) {
                db.set(cacheKey, cookie, 300); // Valid for 5 minutes
                return cookie;
            }
            await new Promise(r => setTimeout(r, 500));
        }
        return cookie || null;
    } catch (e) {
        console.error('[NetMirror] Bypass error:', e instanceof Error ? e.message : e);
        return null;
    }
}

const netmirrorProvider: Provider = {
    id: SITE_CONFIG.id,
    name: SITE_CONFIG.name,
    enabled: true,
    weight: 90,

    async search(query: string, _type: string): Promise<MediaItem[]> {
        try {
            const bypass = await getBypassCookie();
            const ts = Date.now();
            const res = await axios.get(`${SITE_CONFIG.mainUrl}/search.php?s=${encodeURIComponent(query)}&t=${ts}`, {
                headers: {
                    ...DEFAULT_HEADERS,
                    'Cookie': bypass ? `t_hash_t=${bypass}; hd=on` : 'hd=on'
                },
                timeout: 10000
            });

            if (!res.data || !Array.isArray(res.data)) return [];

            return res.data.map((item: any) => ({
                id: `agg:${SITE_CONFIG.id}:${item.id}`,
                type: item.type === 'series' ? 'series' : 'movie',
                title: item.title,
                year: parseInt(item.year) || undefined,
            }));
        } catch (err) {
            console.error('[NetMirror] Search error:', err);
            return [];
        }
    },

    async getMeta(id: string, type: string): Promise<Meta | null> {
        const cacheKey = `meta:agg:${SITE_CONFIG.id}:${id}`;
        const cached = db.get(cacheKey) as Meta | null;
        if (cached) return cached;

        try {
            const bypass = await getBypassCookie();
            const ts = Date.now();
            // Fetch series episodes if it's a series
            if (type === 'series') {
                const res = await axios.get(`${SITE_CONFIG.mainUrl}/episodes.php?s=${id}&t=${ts}`, {
                    headers: {
                        ...DEFAULT_HEADERS,
                        'Cookie': bypass ? `t_hash_t=${bypass}; hd=on` : 'hd=on'
                    },
                    timeout: 10000
                });

                const meta: Meta = {
                    id: `agg:${SITE_CONFIG.id}:${id}`,
                    type: 'series',
                    name: 'Series', // Will be updated by aggregator from Cinemeta
                    videos: []
                };

                if (Array.isArray(res.data)) {
                    meta.videos = res.data.map((ep: any) => ({
                        id: `agg:${SITE_CONFIG.id}:${id}:${ep.id}`,
                        title: ep.title || `Episode ${ep.episode}`,
                        season: parseInt(ep.season) || 1,
                        episode: parseInt(ep.episode) || 1,
                        released: new Date().toISOString()
                    }));
                }
                db.set(cacheKey, meta, 3600);
                return meta;
            } else {
                // For movies, we don't have separate episode IDs
                return {
                    id: `agg:${SITE_CONFIG.id}:${id}`,
                    type: 'movie',
                    name: 'Movie'
                };
            }
        } catch (err) {
            console.error('[NetMirror] getMeta error:', err);
            return null;
        }
    },

    async getStreams(item: MediaItem): Promise<Stream[]> {
        console.log(`[NetMirror] Resolving streams for: ${item.title}`);
        
        try {
            const bypass = await getBypassCookie();
            let netId = '';

            // 1. Identify the NetMirror ID
            if (item.id.startsWith(`agg:${SITE_CONFIG.id}:`)) {
                const parts = item.id.split(':');
                // Format: agg:netmirror:seriesId:episodeId OR agg:netmirror:movieId
                netId = parts[parts.length - 1];
            } else {
                // Search by title if it's from Cinemeta
                const results = await this.search!(item.title, item.type);
                if (results.length === 0) return [];
                // Simple matching
                const matched = results.find(r => r.title.toLowerCase().includes(item.title.toLowerCase())) || results[0];
                netId = matched.id.split(':').pop() || '';
                
                // If it's a series, we need to fetch the meta to find the correct episode ID
                if (item.type === 'series' && item.episode) {
                    const meta = await this.getMeta!(netId, 'series');
                    const ep = meta?.videos?.find(v => v.episode === item.episode);
                    if (ep) {
                        netId = ep.id.split(':').pop() || '';
                    }
                }
            }

            if (!netId) return [];

            const commonHeaders = {
                ...DEFAULT_HEADERS,
                'Cookie': bypass ? `t_hash_t=${bypass}; hd=on; ott=nf` : 'hd=on; ott=nf'
            };

            // 2. Step 1: POST to play.php to get 'h'
            const playPostRes = await axios.post(`${SITE_CONFIG.mainUrl}/play.php`, `id=${netId}`, {
                headers: {
                    ...commonHeaders,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            const h = playPostRes.data?.h;
            if (!h) throw new Error('Failed to get "h" token');

            // 3. Step 2: GET from playerUrl to get data-h (token)
            const playerRes = await axios.get(`${SITE_CONFIG.playerUrl}/play.php?id=${netId}&${h}`, {
                headers: {
                    ...commonHeaders,
                    'Referer': SITE_CONFIG.mainUrl + '/'
                }
            });
            const $ = cheerio.load(playerRes.data);
            const token = $('body').attr('data-h');
            if (!token) throw new Error('Failed to get "data-h" token');

            // 4. Step 3: GET playlist.php
            const ts = Date.now();
            const playlistRes = await axios.get(`${SITE_CONFIG.playerUrl}/playlist.php?id=${netId}&h=${token}&tm=${ts}`, {
                headers: {
                    ...commonHeaders,
                    'Referer': `${SITE_CONFIG.playerUrl}/play.php?id=${netId}&${h}`
                }
            });

            if (!playlistRes.data || !Array.isArray(playlistRes.data)) return [];

            // 5. Convert to Streams
            return playlistRes.data.map((track: any) => {
                const rawUrl = track.file.startsWith('http') ? track.file : `${SITE_CONFIG.playerUrl}${track.file}`;
                return {
                    url: buildHlsProxyUrl(rawUrl, {
                        referer: SITE_CONFIG.playerUrl + '/',
                        userAgent: DEFAULT_HEADERS['User-Agent']
                    }),
                    name: `[${track.label || 'Auto'}] NetMirror`,
                    description: `${item.title} · OTT Mirror`,
                };
            });

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[NetMirror] Stream resolution error:`, message);
            return [];
        }
    }
};

export default netmirrorProvider;
