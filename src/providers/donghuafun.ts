import axios from 'axios';
import * as cheerio from 'cheerio';
import { Provider, MediaItem, Stream, Meta } from '../types';
import { resolveDM } from '../utils/embedResolver';

const SITE_CONFIG = {
  id: 'donghuafun',
  name: 'DonghuaFun',
  mainUrl: 'https://donghuafun.com',
  apiBase: 'https://donghuafun.com/api.php/provide/vod/at/json',
  lang: 'zh',
};

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

// ── MacCMS API types ──────────────────────────────────────────────────────────

interface MacCmsItem {
  vod_id: number;
  vod_name: string;
  vod_pic?: string;
  vod_pic_slide?: string;
  vod_content?: string;
  vod_blurb?: string;
  vod_year?: string;
  vod_class?: string;
  vod_remarks?: string;
  vod_play_from?: string;
  vod_play_url?: string;
  vod_time_add?: number;
}

interface MacCmsResponse {
  list: MacCmsItem[];
  total: number;
  pagecount: number;
  page: number;
}

// ── MacCMS API helpers ────────────────────────────────────────────────────────

async function maccmsSearch(query: string): Promise<MacCmsResponse> {
  const url = `${SITE_CONFIG.apiBase}?ac=list&t=20&wd=${encodeURIComponent(query)}`;
  const res = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 10000 });

  if (res.data && res.data.list && res.data.list.length > 0) {
    return res.data;
  }

  // Fallback to HTML search for Chinese queries
  try {
    const htmlUrl = `${SITE_CONFIG.mainUrl}/index.php/vod/search.html?wd=${encodeURIComponent(query)}`;
    const htmlRes = await axios.get(htmlUrl, { headers: DEFAULT_HEADERS, timeout: 10000 });
    const $ = cheerio.load(htmlRes.data);
    const list: MacCmsItem[] = [];

    $('.public-list-exp').each((_, el) => {
      const href = $(el).attr('href');
      const title = $(el).attr('title') || '';
      if (href && href.includes('/vod/detail/id/')) {
        const idMatch = href.match(/id\/(\d+)\.html/);
        if (idMatch) {
          list.push({
            vod_id: parseInt(idMatch[1]),
            vod_name: title
          });
        }
      }
    });

    if (list.length > 0) {
      return { list, total: list.length, pagecount: 1, page: 1 };
    }
  } catch (err) {
    console.error(`[${SITE_CONFIG.name}] HTML search fallback failed:`, err);
  }

  return res.data;
}

async function maccmsDetail(ids: number | number[]): Promise<MacCmsResponse> {
  const idStr = Array.isArray(ids) ? ids.join(',') : String(ids);
  const url = `${SITE_CONFIG.apiBase}?ac=detail&ids=${idStr}`;
  const res = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 10000 });
  return res.data;
}

async function maccmsList(page: number = 1): Promise<MacCmsResponse> {
  const url = `${SITE_CONFIG.apiBase}?ac=detail&t=20&pg=${page}`;
  const res = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 10000 });
  return res.data;
}

// ── Episode parsing ───────────────────────────────────────────────────────────

interface ParsedEpisode {
  name: string;
  dmVideoId: string;
  episodeNumber: number;
}

function parseEpNumber(epName: string, fallbackIndex: number = 0): number {
  if (!epName) return fallbackIndex + 1;
  const m = epName.match(/(?:Episode|Eps?|第)\s*(\d+)/i) || epName.match(/(\d+)/);
  return m ? parseInt(m[1]) : fallbackIndex + 1;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Parse Dailymotion episodes from a MacCMS detail item.
 * Returns episodes from the 'dailymotion' source only.
 */
function parseDailymotionEpisodes(item: MacCmsItem): ParsedEpisode[] {
  const sources = (item.vod_play_from || '').split('$$$');
  const urlBlocks = (item.vod_play_url || '').split('$$$');

  const dmIndex = sources.findIndex(s => s.toLowerCase() === 'dailymotion');
  if (dmIndex === -1) return [];

  const dmBlock = urlBlocks[dmIndex] || '';
  const episodes = dmBlock.split('#').filter(Boolean);

  return episodes.map((ep, idx) => {
    const [epName, dmId] = ep.split('$');
    return {
      name: epName || dmId,
      dmVideoId: dmId,
      episodeNumber: parseEpNumber(epName, idx),
    };
  });
}

// ── Catalog & Meta helpers ────────────────────────────────────────────────────

async function getCatalog(search?: string, skip: number = 0): Promise<Meta[]> {
  try {
    let listData: MacCmsResponse;

    if (search) {
      listData = await maccmsSearch(search);
    } else {
      const page = Math.floor(skip / 200) + 1;
      listData = await maccmsList(page);
    }

    const items = listData.list || [];
    if (items.length === 0) return [];

    // videolist already returns full detail including vod_pic,
    // but search fallback (HTML) only returns IDs — fetch detail if needed
    let finalItems = items;
    if (!finalItems[0]?.vod_pic) {
      const ids = finalItems.map(i => i.vod_id);
      const detailData = await maccmsDetail(ids);
      finalItems = detailData.list || [];
    }

    return finalItems.map(item => ({
      id: `agg:${SITE_CONFIG.id}:${item.vod_id}`,
      type: 'series',
      name: item.vod_name,
      poster: item.vod_pic || undefined,
      posterShape: 'poster',
      description: item.vod_remarks || '',
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${SITE_CONFIG.name}] Catalog error: ${message}`);
    return [];
  }
}

async function getMetaById(vodId: string): Promise<Meta | null> {
  try {
    const data = await maccmsDetail(parseInt(vodId));
    const item = (data.list || [])[0];
    if (!item) return null;

    const meta: any = {
      id: `agg:${SITE_CONFIG.id}:${item.vod_id}`,
      type: 'series',
      name: item.vod_name,
      poster: item.vod_pic || undefined,
      posterShape: 'poster',
      background: item.vod_pic_slide
        ? (item.vod_pic_slide.startsWith('http')
          ? item.vod_pic_slide
          : `${SITE_CONFIG.mainUrl}/${item.vod_pic_slide.replace(/^\//, '')}`)
        : undefined,
      description: stripHtml(item.vod_content || item.vod_blurb || ''),
      year: item.vod_year ? parseInt(item.vod_year) : undefined,
      videos: [],
    };

    const episodes = parseDailymotionEpisodes(item);
    const baseTs = item.vod_time_add ? item.vod_time_add * 1000 : Date.now();
    const totalEps = episodes.length;

    meta.videos = episodes.map((ep, idx) => {
      const epDateTs = baseTs - ((totalEps - 1 - idx) * 86400000);
      return {
        id: `agg:${SITE_CONFIG.id}:${item.vod_id}:${ep.dmVideoId}`,
        title: ep.name || ep.dmVideoId,
        season: 1,
        episode: ep.episodeNumber,
        released: new Date(epDateTs).toISOString(),
      };
    }).reverse();

    return meta;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${SITE_CONFIG.name}] Meta error: ${message}`);
    return null;
  }
}

// ── Provider implementation ───────────────────────────────────────────────────

const donghuafunProvider: Provider = {
  id: SITE_CONFIG.id,
  name: SITE_CONFIG.name,
  enabled: true,
  weight: 100,

  async resolveMediaItem(id: string, type: string): Promise<MediaItem | null> {
    // id format: agg:donghuafun:<vodId>  or  agg:donghuafun:<vodId>:<dmVideoId>
    const prefix = `agg:${SITE_CONFIG.id}:`;
    if (!id.startsWith(prefix)) return null;
    const internalId = id.slice(prefix.length);
    const parts = internalId.split(':');
    const vodId = parts[0];
    const dmVideoId = parts[1]; // may be undefined for series-level IDs

    const meta = await getMetaById(vodId).catch(() => null);
    if (!meta) return null;

    let episodeNum: number | undefined;
    if (dmVideoId && meta.videos) {
      const video = meta.videos.find(v => v.id === id);
      episodeNum = video?.episode;
    }

    return {
      id,
      type: type as any,
      name: meta.name,
      title: meta.name,
      aliases: meta.aliases || [],
      season: 1,
      episode: episodeNum,
    };
  },

  async search(query: string, type: string): Promise<MediaItem[]> {
    const metas = await getCatalog(query);
    return metas.map(m => ({
      id: m.id,
      type: 'series' as const,
      name: m.name,
      title: m.name,
    }));
  },

  async getCatalog(type: string, extra: any): Promise<Meta[]> {
    return await getCatalog(extra?.search, extra?.skip ? parseInt(extra.skip) : 0);
  },

  async getMeta(id: string, type: string): Promise<Meta | null> {
    // internalId passed from aggregator is already stripped of "agg:donghuafun:"
    // it may be "<vodId>" or "<vodId>:<dmVideoId>"
    const vodId = id.split(':')[0];
    return await getMetaById(vodId);
  },

  async getStreams(item: MediaItem): Promise<Stream[]> {
    const epLog = item.episode ? ` S${item.season || 1}E${item.episode}` : '';
    console.log(`[${SITE_CONFIG.name}] Requesting streams for: ${item.title}${epLog} (ID: ${item.id})`);

    try {
      // Fast path: if the ID encodes the dmVideoId directly (agg:donghuafun:<vodId>:<dmVideoId>)
      if (item.id.startsWith(`agg:${SITE_CONFIG.id}:`)) {
        const parts = item.id.split(':');
        // parts: ['agg', 'donghuafun', vodId, dmVideoId]
        if (parts.length >= 4) {
          const dmVideoId = parts[3];
          const resolved = await resolveDM(dmVideoId, SITE_CONFIG.name);
          if (resolved) {
            return [resolved];
          }
          return [];
        }
      }
      // Step 1: Search by title (with fallback aliases)
      let searchData: MacCmsResponse | null = null;
      const searchQueries = [item.title, ...(item.aliases || [])];

      for (const query of searchQueries) {
        if (!query) continue;
        const data = await maccmsSearch(query);
        if (data.list && data.list.length > 0) {
          searchData = data;
          break;
        }
      }

      if (!searchData || !searchData.list || searchData.list.length === 0) {
        console.log(`[${SITE_CONFIG.name}] No results for: ${item.title}`);
        return [];
      }

      // Step 2: Get detail for all matching items
      const ids = searchData.list.map(i => i.vod_id);
      const detailData = await maccmsDetail(ids);
      if (!detailData.list || detailData.list.length === 0) {
        return [];
      }

      // Step 3: Find the best match by title similarity, then parse episodes
      const primaryTitle = item.title || item.name || '';
      const validTitles = [primaryTitle, ...(item.aliases || [])]
        .filter((t): t is string => !!t)
        .map(t => t.toLowerCase());

      // Score each result: exact match > partial match
      const scoredItems = detailData.list.map(vodItem => {
        const nameLower = vodItem.vod_name.toLowerCase();
        let score = 0;
        if (validTitles.some(t => t === nameLower)) score += 100;
        else if (validTitles.some(t => nameLower.includes(t) || t.includes(nameLower))) score += 50;
        return { vodItem, score };
      }).filter(x => x.score > 0 || detailData.list.length === 1);

      // If no title match at all, fall back to using all results
      const candidates = scoredItems.length > 0 ? scoredItems : detailData.list.map(v => ({ vodItem: v, score: 0 }));
      candidates.sort((a, b) => b.score - a.score);

      const streams: Stream[] = [];

      for (const { vodItem } of candidates) {
        const episodes = parseDailymotionEpisodes(vodItem);
        if (episodes.length === 0) continue;

        const targetEp = item.episode || 1;
        const matchedEp = episodes.find(ep => ep.episodeNumber === targetEp);
        if (matchedEp) {
          // Resolve Dailymotion HLS
          const resolved = await resolveDM(matchedEp.dmVideoId, SITE_CONFIG.name);
          if (resolved) {
            streams.push(resolved);
          } else {
            console.log(`[${SITE_CONFIG.name}] Could not resolve DM stream for ${matchedEp.dmVideoId}`);
          }
        } else {
          console.log(`[${SITE_CONFIG.name}] No matching episode found for S${item.season || 1}E${targetEp} in ${vodItem.vod_name}`);
        }
      }

      return streams;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${SITE_CONFIG.name}] Error:`, message);
      return [];
    }
  },
};

export default donghuafunProvider;
