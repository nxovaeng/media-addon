import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { Provider, MediaItem, Meta, Stream } from '../types';

const CANDIDATE_DOMAINS = [
  'https://www.pipishi.fun',
  'https://www.pipishi.pro',
  'https://www.pipishi.me',
  'https://www.pipishi.cc',
];

const PROBE_TIMEOUT = 5000;
const RECHECK_INTERVAL = 30 * 60 * 1000;
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};
const JS_KEY = 'jZ#8C*d!2Kx$mP@5';

interface DomainState {
  active: string;
  lastChecked: number;
  checking: boolean;
}

const domainState: DomainState = {
  active: CANDIDATE_DOMAINS[0],
  lastChecked: 0,
  checking: false,
};

let globalCookie = '';

async function probeDomain(domain: string): Promise<number> {
  const start = Date.now();
  try {
    const res = await axios.get(`${domain}/`, {
      headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'] },
      timeout: PROBE_TIMEOUT,
      validateStatus: () => true,
      maxRedirects: 5,
    });
    return res.status === 200 ? Date.now() - start : Infinity;
  } catch {
    return Infinity;
  }
}

async function detectBestDomain(): Promise<void> {
  if (domainState.checking) return;
  domainState.checking = true;

  try {
    const results = await Promise.all(
      CANDIDATE_DOMAINS.map(async (domain) => ({ domain, latency: await probeDomain(domain) }))
    );
    results.sort((a, b) => a.latency - b.latency);
    const best = results.find((item) => item.latency !== Infinity);
    if (best && best.domain !== domainState.active) {
      console.log(`[PiPiShi] Switching domain: ${domainState.active} → ${best.domain}`);
      domainState.active = best.domain;
      globalCookie = '';
    }
  } finally {
    domainState.lastChecked = Date.now();
    domainState.checking = false;
  }
}

detectBestDomain().catch(() => {});

function getActiveMainUrl(): string {
  const now = Date.now();
  if (now - domainState.lastChecked > RECHECK_INTERVAL) {
    detectBestDomain().catch(() => {});
  }
  return domainState.active;
}

function rewriteUrlDomain(url: string, newMainUrl: string): string {
  try {
    const u = new URL(url);
    const n = new URL(newMainUrl);
    u.protocol = n.protocol;
    u.host = n.host;
    return u.toString();
  } catch {
    return url;
  }
}

function base64encode(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64');
}

function encrypt(txt: string, key: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const nh = Math.floor(Math.random() * 64);
  const ch = chars.charAt(nh);
  let mdKey = crypto.createHash('md5').update(key + ch).digest('hex');
  mdKey = mdKey.substring(nh % 8, nh % 8 + (nh % 8 > 7 ? nh % 8 : nh % 8 + 17));
  txt = base64encode(txt);
  let tmp = '';
  let k = 0;

  for (let i = 0; i < txt.length; i++) {
    if (k === mdKey.length) k = 0;
    tmp += String.fromCharCode(txt.charCodeAt(i) ^ mdKey.charCodeAt(k++));
  }

  return encodeURIComponent(ch + base64encode(tmp));
}

async function _doFetch(url: string, mainUrl: string): Promise<AxiosResponse<any>> {
  const headers = { ...DEFAULT_HEADERS } as Record<string, string>;
  if (globalCookie) headers.Cookie = globalCookie;

  let res = await axios.get(url, {
    headers,
    validateStatus: () => true,
    timeout: 15000,
  });

  if (res.headers['set-cookie']) {
    globalCookie = (res.headers['set-cookie'] as string[])
      .map((c) => c.split(';')[0])
      .join('; ');
  }

  if (res.status === 200 && typeof res.data === 'string' && res.data.includes('robot.php')) {
    const staticMatch1 = res.data.match(/var\s+staticchars\s*=\s*'([^']+)'/);
    const tokenMatch1 = res.data.match(/var\s+token\s*=\s*'([^']+)'/);
    const tokenMatch2 = res.data.match(/var\s+token\s*=\s*encrypt\("([^\"]+)"\);/);
    const staticMatch2 = res.data.match(/var\s+staticchars\s*=\s*"([^"]+)"/);

    if (staticMatch1 && tokenMatch1 && res.data.includes('math.random')) {
      const p = encrypt(staticMatch1[1], tokenMatch1[1]);
      const verifyUrl = `${mainUrl}/static/js/robot.php?p=${p}&${tokenMatch1[1]}=`;
      const vr = await axios.get(verifyUrl, {
        headers: { ...DEFAULT_HEADERS, Cookie: globalCookie, Referer: url },
        validateStatus: () => true,
        timeout: 15000,
      });
      if (vr.headers['set-cookie']) {
        globalCookie = (vr.headers['set-cookie'] as string[])
          .map((c) => c.split(';')[0])
          .join('; ');
      }
      res = await axios.get(url, { headers: { ...DEFAULT_HEADERS, Cookie: globalCookie }, validateStatus: () => true, timeout: 15000 });
    } else if (tokenMatch2 && staticMatch2) {
      const encrypt2 = (_str: string) => {
        let out = '';
        for (let i = 0; i < _str.length; i++) {
          const idx = staticMatch2[1].indexOf(_str[i]);
          out += staticMatch2[1][Math.floor(Math.random() * 62)] + (idx === -1 ? _str[i] : staticMatch2[1][(idx + 3) % 62]) + staticMatch2[1][Math.floor(Math.random() * 62)];
        }
        return Buffer.from(out).toString('base64');
      };
      const postData = `value=${encodeURIComponent(encrypt2(url))}&token=${encodeURIComponent(encrypt2(tokenMatch2[1]))}`;
      const vr = await axios.post(`${mainUrl}/robot.php`, postData, {
        headers: { ...DEFAULT_HEADERS, Cookie: globalCookie, Referer: url, 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 10000,
      });
      if (vr.headers['set-cookie']) {
        globalCookie = (vr.headers['set-cookie'] as string[])
          .map((c) => c.split(';')[0])
          .join('; ');
      }
      res = await axios.get(url, { headers: { ...DEFAULT_HEADERS, Cookie: globalCookie }, validateStatus: () => true, timeout: 15000 });
    }
  }

  return res;
}

async function postWithBypass(url: string, data: string, extraHeaders: Record<string, string> = {}): Promise<AxiosResponse<any> | null> {
  try {
    const headers = { ...DEFAULT_HEADERS, ...extraHeaders } as Record<string, string>;
    if (globalCookie) headers.Cookie = globalCookie;
    const res = await axios.post(url, data, {
      headers,
      validateStatus: () => true,
      timeout: 10000,
    });
    if (res.headers['set-cookie']) {
      globalCookie = (res.headers['set-cookie'] as string[])
        .map((c) => c.split(';')[0])
        .join('; ');
    }
    return res;
  } catch (err) {
    console.error('[PiPiShi] Post error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function fetchWithBypass(url: string, mainUrl?: string): Promise<string | null> {
  const activeMain = mainUrl || getActiveMainUrl();
  const finalUrl = rewriteUrlDomain(url, activeMain);

  try {
    return (await _doFetch(finalUrl, activeMain)).data;
  } catch (err: unknown) {
    console.warn(`[PiPiShi] fetchWithBypass failed on ${activeMain}: ${err instanceof Error ? err.message : String(err)}, trying fallback...`);
    for (const domain of CANDIDATE_DOMAINS) {
      if (domain === activeMain) continue;
      try {
        const fallbackUrl = rewriteUrlDomain(finalUrl, domain);
        const res = await _doFetch(fallbackUrl, domain);
        if (res.status === 200) {
          console.log(`[PiPiShi] Fallback succeeded with ${domain}`);
          domainState.active = domain;
          globalCookie = '';
          return res.data;
        }
      } catch {
        // ignore
      }
    }
    console.error('[PiPiShi] All domains failed for:', url);
    return null;
  }
}

function resolveImg(img: string | null | undefined, mainUrl: string): string | undefined {
  if (!img) return undefined;
  return img.startsWith('http') ? img : `${mainUrl}${img}`;
}

const SITE = {
  id: 'pipishi',
  name: 'PiPiShi',
  get activeMainUrl() {
    return getActiveMainUrl();
  },
  catalogs: [
    { typeId: 1, id: 'pipishi_movies', name: '皮皮狮 电影', type: 'movie' },
    { typeId: 2, id: 'pipishi_series', name: '皮皮狮 剧集', type: 'series' },
    { typeId: 3, id: 'pipishi_variety', name: '皮皮狮 综艺', type: 'series' },
    { typeId: 4, id: 'pipishi_anime', name: '皮皮狮 动漫', type: 'series' },
  ],
};

function parseId(stremioId: string) {
  const parts = stremioId.split(':');
  return {
    siteId: parts[0],
    vodId: parts[1],
    episode: parseInt(parts[2] || '1', 10) || 1,
  };
}

async function getRecent(typeId: number, skip = 0) {
  const mainUrl = SITE.activeMainUrl;
  const page = Math.floor(skip / 36) + 1;
  const listUrl = `${mainUrl}/list/${typeId}--hits------${page}---.html`;
  const html = await fetchWithBypass(listUrl, mainUrl);
  if (!html) return [];

  const $ = cheerio.load(html);
  const results: Array<{ id: string; vodId: string; title: string; poster?: string; remark?: string; type: string }> = [];

  $('a.module-poster-item, a.module-item').each((_, el) => {
    const element = $(el);
    const link = element.attr('href');
    const title = element.attr('title') || '';
    const img = element.find('img').attr('data-original') || element.find('img').attr('data-src');
    const idMatch = link ? link.match(/\/vod\/(\d+)\.html/) : null;
    const vodId = idMatch ? idMatch[1] : null;
    if (vodId && title && !results.find((r) => r.vodId === vodId)) {
      results.push({
        id: `agg:${SITE.id}:${vodId}`,
        vodId,
        title,
        poster: resolveImg(img, mainUrl),
        remark: element.find('.module-item-note').text().trim(),
        type: 'series',
      });
    }
  });

  return results;
}

async function searchPipishi(query: string) {
  if (!query) return [];
  const mainUrl = SITE.activeMainUrl;
  const searchUrl = `${mainUrl}/search/${encodeURIComponent(query)}-------------.html`;
  const html = await fetchWithBypass(searchUrl, mainUrl);
  if (!html) return [];

  const $ = cheerio.load(html);
  const results: Array<{ id: string; vodId: string; title: string; poster?: string; type: string }> = [];

  $('a.module-poster-item, a.module-item, .module-card-item').each((_, el: any) => {
    const element = $(el);
    let link = element.attr('href');
    let title = element.attr('title') || '';
    let img = element.find('img').attr('data-original') || element.find('img').attr('data-src');

    if (!title) {
      const titleEl = element.find('.module-card-item-title a, a');
      title = titleEl.text().trim() || titleEl.attr('title') || '';
      link = titleEl.attr('href') || link;
    }

    const idMatch = link ? link.match(/\/vod\/(\d+)\.html/) : null;
    const vodId = idMatch ? idMatch[1] : null;
    const typeText = element.find('.module-card-item-class, .module-item-note').text().trim();
    const type = typeText === '电影' || typeText === '正片' ? 'movie' : 'series';

    if (vodId && title) {
      results.push({ id: `agg:${SITE.id}:${vodId}`, vodId, title, poster: resolveImg(img, mainUrl), type });
    }
  });

  return results;
}

async function getMeta(vodId: string): Promise<Meta | null> {
  const mainUrl = SITE.activeMainUrl;
  const detailUrl = `${mainUrl}/vod/${vodId}.html`;
  const html = await fetchWithBypass(detailUrl, mainUrl);
  if (!html) return null;

  const $ = cheerio.load(html);
  const title = $('h1').text().trim();
  const img = $('.module-item-pic img').attr('data-original') || $('.module-item-pic img').attr('data-src');
  const poster = resolveImg(img, mainUrl);
  const description = $('.module-info-introduction-content p').text().trim() || $('.module-info-introduction-content').text().trim();

  const episodes: Array<{ id: string; title: string; episode: number; season: number; released: string }> = [];
  $('.module-list').first().find('a').each((_, el) => {
    const element = $(el);
    const link = element.attr('href');
    const epTitle = element.text().trim();
    const match = link ? link.match(/\/play\/(\d+)-(\d+)-(\d+)\.html/) : null;
    if (match) {
      const epNum = parseInt(match[3], 10);
      if (!episodes.find((e) => e.episode === epNum)) {
        episodes.push({ id: `${SITE.id}:${vodId}:${epNum}`, title: epTitle || `第${epNum}集`, episode: epNum, season: 1, released: new Date().toISOString() });
      }
    }
  });

  const isSeries = episodes.length > 1 || (episodes.length === 1 && episodes[0].title.includes('集'));

  return {
    id: `agg:${SITE.id}:${vodId}`,
    type: isSeries ? 'series' : 'movie',
    name: title || `PiPiShi ${vodId}`,
    poster: poster || undefined,
    posterShape: 'poster',
    background: poster || undefined,
    description,
    videos: isSeries ? episodes : undefined,
  };
}

async function getPlayLinks(vodId: string, episode = 1) {
  const mainUrl = SITE.activeMainUrl;
  const detailUrl = `${mainUrl}/vod/${vodId}.html`;
  const html = await fetchWithBypass(detailUrl, mainUrl);
  if (!html) return [];

  const $ = cheerio.load(html);
  const sourceNames: string[] = [];
  $('.module-tab-items-box .tab-item, .module-tab-item').each((_, el: any) => {
    const element = $(el);
    sourceNames.push(element.attr('data-dropdown-value') || element.text().replace(/\d+$/, '').trim());
  });

  const playLinks: Array<{ sourceName: string; epLabel: string; playUrl: string }> = [];
  $('.module-list, .module-play-list').each((sourceIndex, listEl) => {
    const sourceName = sourceNames[sourceIndex] || `线路${sourceIndex + 1}`;
    const listElement = $(listEl);
    listElement
      .find('a')
      .each((_, el: any) => {
        const itemElement = $(el);
        const link = itemElement.attr('href');
        const epLabel = itemElement.text().trim();
        const match = link ? link.match(/\/play\/(\d+)-(\d+)-(\d+)\.html/) : null;
        if (match && parseInt(match[3], 10) === episode) {
          playLinks.push({ sourceName, epLabel, playUrl: `${mainUrl}${link}` });
        }
      });
  });

  return playLinks;
}

function md5(str: string) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function decodeStream1(cipherStr: string) {
  const key = md5('test');
  const decoded1 = Buffer.from(cipherStr, 'base64').toString('binary');
  let code = '';
  for (let i = 0; i < decoded1.length; i++) {
    code += String.fromCharCode(decoded1.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }

  const out = Buffer.from(code, 'base64').toString('utf8');
  const parts = out.split('/');
  if (parts.length < 3) return null;

  try {
    const arr1 = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));
    const arr2 = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    const cipherUrl = Buffer.from(parts[2], 'base64').toString('utf8');
    let realUrl = '';
    for (const c of cipherUrl) {
      if (/^[a-zA-Z]$/.test(c)) {
        const idx = arr2.indexOf(c);
        realUrl += idx !== -1 ? arr1[idx] : c;
      } else {
        realUrl += c;
      }
    }
    return realUrl;
  } catch {
    return null;
  }
}

function decodeStream2(input: string) {
  try {
    const decoded = Buffer.from(input, 'base64').toString('binary');
    const chars = 'PXhw7UT1B0a9kQDKZsjIASmOezxYG4CHo5Jyfg2b8FLpEvRr3WtVnlqMidu6cN';
    let res = '';
    for (let i = 1; i < decoded.length; i += 3) {
      const idx = chars.indexOf(decoded[i]);
      res += idx === -1 ? decoded[i] : chars[(idx + 59) % 62];
    }
    return res;
  } catch {
    return null;
  }
}

async function resolvePipishiStream(playUrl: string): Promise<{ url: string; headers: Record<string, string> } | null> {
  const mainUrl = getActiveMainUrl();
  const playHtml = await fetchWithBypass(playUrl, mainUrl);
  if (!playHtml) return null;

  const playerMatch = playHtml.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (!playerMatch) {
    console.error(`[PiPiShi] player_aaaa not found in: ${playUrl}`);
    return null;
  }

  let playerData: any;
  try {
    playerData = JSON.parse(playerMatch[1]);
  } catch (err) {
    console.error('[PiPiShi] Failed to parse player_aaaa:', err instanceof Error ? err.message : String(err));
    return null;
  }

  const apiUrl = `${mainUrl}/lionplay/api.php`;
  const apiRes = await postWithBypass(apiUrl, `vid=${encodeURIComponent(playerData.url)}`, {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: mainUrl,
    Referer: `${mainUrl}/lionplay/index.php?vid=${playerData.url}`,
  });

  if (!apiRes || apiRes.status !== 200 || !apiRes.data?.data) {
    return null;
  }

  const streamData = apiRes.data.data;
  let streamUrl = '';
  if (streamData.urlmode === 1) {
    streamUrl = decodeStream1(streamData.url) || '';
  } else if (streamData.urlmode === 2) {
    streamUrl = decodeStream2(streamData.url) || '';
  } else if (typeof streamData.url === 'string' && streamData.url.startsWith('http')) {
    streamUrl = streamData.url;
  }

  if (!streamUrl || streamUrl.includes('404.mp4')) {
    return null;
  }

  return {
    url: streamUrl,
    headers: {
      Referer: playUrl,
      Origin: mainUrl,
      'User-Agent': DEFAULT_HEADERS['User-Agent'],
    },
  };
}

const pipishiProvider: Provider = {
  id: 'pipishi',
  name: 'PiPiShi',
  enabled: true,
  weight: 85,

  async resolveMediaItem(id: string, type: string): Promise<MediaItem | null> {
    const prefix = `agg:pipishi:`;
    if (!id.startsWith(prefix)) return null;
    const internalId = id.slice(prefix.length);
    const [vodId, episodeStr] = internalId.split(':');
    const episode = parseInt(episodeStr || '1', 10) || 1;
    const meta = await getMeta(vodId).catch(() => null);
    if (!meta) return null;
    return {
      id,
      type: type as 'movie' | 'series',
      name: meta.name,
      title: meta.name,
      aliases: meta.aliases,
      season: 1,
      episode,
    };
  },

  async search(query: string): Promise<MediaItem[]> {
    const results = await searchPipishi(query);
    return results.map((r) => ({ 
      id: r.id, 
      type: (r.type as 'movie' | 'series'), 
      name: r.title,
      title: r.title 
    }));
  },

  async getCatalog(type: string, extra: any): Promise<Meta[]> {
    if (extra?.search) {
      const results = await searchPipishi(extra.search);
      return results.map((r) => ({ 
        id: r.id, 
        type: r.type as 'movie' | 'series', 
        name: r.title || 'Unknown', 
        title: r.title,
        poster: r.poster, 
        posterShape: 'poster' as const 
      }));
    }

    const catalogs = SITE.catalogs.filter((cat) => cat.type === type);
    if (catalogs.length === 0) return [];

    const metas = await Promise.all(
      catalogs.map((catalog) => getRecent(catalog.typeId, extra?.skip ? parseInt(extra.skip, 10) : 0))
    );

    return metas.flat().map((r) => ({
      id: r.id,
      type: type as 'movie' | 'series',
      name: r.title || 'Unknown',
      title: r.title,
      poster: r.poster,
      posterShape: 'poster' as const,
      description: r.remark,
    }));
  },

  async getMeta(id: string): Promise<Meta | null> {
    const internalId = id.startsWith('agg:pipishi:') ? id.slice('agg:pipishi:'.length) : id;
    const [vodId] = internalId.split(':');
    return await getMeta(vodId);
  },

  async getStreams(item: MediaItem): Promise<Stream[]> {
    const internalId = item.id.startsWith('agg:pipishi:') ? item.id.slice('agg:pipishi:'.length) : null;
    let playLinks: Array<{ sourceName: string; epLabel: string; playUrl: string }> = [];

    if (internalId) {
      const [vodId, episodeStr] = internalId.split(':');
      const episode = parseInt(episodeStr || String(item.episode || 1), 10) || 1;
      playLinks = await getPlayLinks(vodId, episode);
    } else {
      const query = item.title || item.name || '';
      if (!query) return [];
      const results = await searchPipishi(query);
      if (results.length === 0) return [];
      const best = results[0];
      const episode = item.episode || 1;
      playLinks = await getPlayLinks(best.vodId, episode);
    }

    const streams: Stream[] = [];
    for (const link of playLinks) {
      const resolved = await resolvePipishiStream(link.playUrl);
      if (!resolved) continue;
      streams.push({
        url: resolved.url,
        name: link.sourceName,
        description: link.epLabel,
        headers: resolved.headers,
        behaviorHints: { notWebReady: true, bingeGroup: `pipishi-${link.sourceName}` },
      });
    }

    return streams;
  },
};

export default pipishiProvider;
