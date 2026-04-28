import axios from 'axios';
import { Provider, MediaItem, Stream, Meta } from '../types';
import { db } from '../utils/db';
import { buildHlsProxyUrl } from '../utils/mediaflow';

const SITE_CONFIG = {
    id: 'netmirror',
    name: 'NetMirror',
    mainUrl: 'https://net52.cc',
};

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Android) ExoPlayer',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': SITE_CONFIG.mainUrl + '/'
};

async function getBypassCookie(): Promise<string | null> {
    const cacheKey = 'netmirror:bypass';
    const cached = db.get(cacheKey) as string;
    if (cached) return cached;

    try {
        const res = await axios.get(`${SITE_CONFIG.mainUrl}/`, { headers: DEFAULT_HEADERS });
        const cookie = res.headers['set-cookie']?.find(c => c.startsWith('t_hash='));
        if (cookie) {
            const value = cookie.split(';')[0].split('=')[1];
            db.set(cacheKey, value, 86400);
            return value;
        }
        return null;
    } catch (err) {
        return null;
    }
}

const netmirrorProvider: Provider = {
    id: SITE_CONFIG.id,
    name: SITE_CONFIG.name,
    enabled: true,
    weight: 40,

    async getStreams(item: MediaItem): Promise<Stream[]> {
        const title = item.title || item.name || 'Unknown';
        try {
            const bypass = await getBypassCookie();
            let netId = '';
            let netTitle = title;

            if (item.id.startsWith(`agg:${SITE_CONFIG.id}:`)) {
                netId = item.id.split(':').pop() || '';
            } else {
                const results = await this.search!(title, item.type);
                if (results.length === 0) return [];
                const matched = results.find(r => (r.title || r.name || '').toLowerCase().includes(title.toLowerCase())) || results[0];
                netId = matched.id.split(':').pop() || '';
                netTitle = matched.title || matched.name || title;

                if (item.type === 'series' && item.episode) {
                    const meta = await this.getMeta!(netId, 'series');
                    const ep = meta?.videos?.find(v => v.episode === item.episode);
                    if (ep) netId = ep.id.split(':').pop() || '';
                }
            }

            if (!netId) return [];

            const ts = Date.now();
            const playlistRes = await axios.get(`${SITE_CONFIG.mainUrl}/mobile/playlist.php?id=${netId}&t=${encodeURIComponent(netTitle)}&tm=${ts}`, {
                headers: {
                    ...DEFAULT_HEADERS,
                    'Cookie': bypass ? `t_hash=${bypass}; hd=on; ott=nf` : 'hd=on; ott=nf',
                    'Referer': `${SITE_CONFIG.mainUrl}/`
                },
                timeout: 10000
            });

            if (!playlistRes.data || !Array.isArray(playlistRes.data)) return [];

            const streams: Stream[] = [];
            for (const streamItem of playlistRes.data) {
                if (Array.isArray(streamItem.sources)) {
                    for (const source of streamItem.sources) {
                        const rawUrl = source.file.startsWith('http') ? source.file : `${SITE_CONFIG.mainUrl}${source.file}`;
                        streams.push({
                            url: buildHlsProxyUrl(rawUrl, {
                                referer: SITE_CONFIG.mainUrl + '/',
                                userAgent: 'Mozilla/5.0 (Android) ExoPlayer',
                                cookie: bypass ? `t_hash=${bypass}; hd=on; ott=nf` : 'hd=on; ott=nf'
                            }),
                            name: `[${source.label || 'Auto'}] NetMirror`,
                            description: `OTT Mirror · ${source.type || 'HLS'}`,
                        });
                    }
                }
            }
            return streams;
        } catch (err) {
            console.error(`[NetMirror] Stream error:`, err instanceof Error ? err.message : String(err));
            return [];
        }
    },

    async search(query: string, type: string): Promise<MediaItem[]> {
        try {
            const res = await axios.get(`${SITE_CONFIG.mainUrl}/search.php?query=${encodeURIComponent(query)}&type=${type}`, {
                headers: DEFAULT_HEADERS
            });
            // Placeholder for search parsing logic
            return [];
        } catch (err) {
            return [];
        }
    },

    async getMeta(id: string, type: string): Promise<Meta | null> {
        // Placeholder for detail parsing logic
        return null;
    }
};

export default netmirrorProvider;
