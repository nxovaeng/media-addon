import axios from 'axios';
import * as cheerio from 'cheerio';
import { Provider, MediaItem, Stream, Meta } from '../types';
import { config } from '../config';
import { db } from '../utils/db';
import { resolveEmbed } from '../utils/embedResolver';

const SITE_CONFIG = {
  id: 'vidlink',
  name: 'VidLink',
  baseUrl: 'https://vidlink.pro',
  tmdbOrg: 'https://www.themoviedb.org',
  tmdbImageBase: 'https://image.tmdb.org/t/p/w500',
};

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const tmdb = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  params: config.TMDB_API_KEY ? { api_key: config.TMDB_API_KEY } : {}
});

function buildMovieMeta(movie: any): Meta {
  const poster = movie.poster_path ? `${SITE_CONFIG.tmdbImageBase}${movie.poster_path}` : movie.poster;
  const year = movie.release_date ? new Date(movie.release_date).getFullYear() : undefined;

  return {
    id: `agg:${SITE_CONFIG.id}:${movie.id}`,
    type: 'movie',
    name: movie.title || movie.name,
    poster,
    description: movie.overview || movie.description || '',
    year,
    aliases: movie.aliases || [],
  };
}

async function fetchPopularMoviesFromApi(page = 1): Promise<Meta[]> {
  const res = await tmdb.get('/movie/popular', { params: { page } });
  return (res.data.results || []).map(buildMovieMeta);
}

async function fetchSearchMoviesFromApi(query: string, page = 1): Promise<Meta[]> {
  const res = await tmdb.get('/search/movie', { params: { query, page } });
  return (res.data.results || []).map(buildMovieMeta);
}

function normalizeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${SITE_CONFIG.tmdbOrg}${url}`;
  return url;
}

function parseTmdbMoviesFromHtml(html: string, maxItems = 20): Meta[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const metas: Meta[] = [];

  $('a[href^="/movie/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/^\/movie\/(\d+)/);
    if (!match) return;
    const tmdbId = match[1];
    if (seen.has(tmdbId)) return;
    seen.add(tmdbId);

    const title = $(el).attr('title') || $(el).find('img').attr('alt') || $(el).text().trim();
    if (!title || title.length === 0) return;

    const poster = normalizeImageUrl($(el).find('img').attr('data-src') || $(el).find('img').attr('src') || undefined);
    metas.push({
      id: `agg:${SITE_CONFIG.id}:${tmdbId}`,
      type: 'movie',
      name: title,
      poster,
    });

    if (metas.length >= maxItems) return false;
  });

  return metas;
}

async function fetchPopularMoviesFromWeb(page = 1): Promise<Meta[]> {
  const url = `${SITE_CONFIG.tmdbOrg}/movie?page=${page}`;
  const res = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 15000 });
  return parseTmdbMoviesFromHtml(res.data);
}

async function searchMoviesFromWeb(query: string): Promise<Meta[]> {
  const url = `${SITE_CONFIG.tmdbOrg}/search?query=${encodeURIComponent(query)}`;
  const res = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 15000 });
  return parseTmdbMoviesFromHtml(res.data);
}

async function fetchMovieMetaFromWeb(tmdbId: string): Promise<Meta | null> {
  const url = `${SITE_CONFIG.tmdbOrg}/movie/${tmdbId}`;
  const res = await axios.get(url, { headers: DEFAULT_HEADERS, timeout: 15000 });
  const $ = cheerio.load(res.data);
  const title = $('section#main h2 a').first().text().trim() || $('section#main h2').first().text().trim();
  const overview = $('div.overview p').text().trim() || $('div.genres').next('p').text().trim();
  const poster = normalizeImageUrl($('div.poster img').attr('data-src') || $('div.poster img').attr('src') || undefined);
  let year: number | undefined;
  const releaseText = $('span.release_date').text().trim() || $('span.release').text().trim();
  if (releaseText) {
    const yearMatch = releaseText.match(/(\d{4})/);
    if (yearMatch) year = parseInt(yearMatch[1]);
  }

  if (!title) return null;
  return {
    id: `agg:${SITE_CONFIG.id}:${tmdbId}`,
    type: 'movie',
    name: title,
    poster,
    description: overview,
    year,
  };
}

async function fetchMovieMetaFromApi(tmdbId: string): Promise<Meta | null> {
  const res = await tmdb.get(`/movie/${tmdbId}`);
  const item = res.data;
  if (!item) return null;

  const aliases = new Set<string>();
  if (item.title) aliases.add(item.title);
  if (item.original_title && item.original_title !== item.title) aliases.add(item.original_title);

  try {
    const altRes = await tmdb.get(`/movie/${tmdbId}/alternative_titles`);
    const titles = altRes.data.titles || [];
    for (const alt of titles) {
      if (alt.title) aliases.add(alt.title);
    }
  } catch (err) {
    console.warn(`[VidLink] Unable to fetch alternative titles for TMDB ${tmdbId}`);
  }

  return {
    id: `agg:${SITE_CONFIG.id}:${tmdbId}`,
    type: 'movie',
    name: item.title,
    poster: item.poster_path ? `${SITE_CONFIG.tmdbImageBase}${item.poster_path}` : undefined,
    description: item.overview,
    year: item.release_date ? new Date(item.release_date).getFullYear() : undefined,
    aliases: Array.from(aliases),
  };
}

const vidlinkProvider: Provider = {
  id: SITE_CONFIG.id,
  name: SITE_CONFIG.name,
  enabled: true,
  weight: 80,

  async getCatalog(type: string, extra: any): Promise<Meta[]> {
    if (type !== 'movie') return [];
    if (extra?.search) {
      try {
        if (config.TMDB_API_KEY) return await fetchSearchMoviesFromApi(extra.search, 1);
        return await searchMoviesFromWeb(extra.search);
      } catch (err) {
        console.error(`[VidLink] Search failed:`, err);
        return [];
      }
    }

    const page = Math.max(1, Math.floor((parseInt(extra?.skip || '0') || 0) / 20) + 1);
    try {
      if (config.TMDB_API_KEY) return await fetchPopularMoviesFromApi(page);
      return await fetchPopularMoviesFromWeb(page);
    } catch (err) {
      console.error(`[VidLink] Popular movie catalog failed:`, err);
      return [];
    }
  },

  async getMeta(id: string, type: string): Promise<Meta | null> {
    if (type !== 'movie') return null;
    const cacheKey = `meta:agg:${SITE_CONFIG.id}:${id}`;
    const cached = db.get(cacheKey) as Meta | null;
    if (cached) return cached;

    try {
      let meta: Meta | null = null;
      if (config.TMDB_API_KEY) {
        meta = await fetchMovieMetaFromApi(id);
      }
      if (!meta) {
        meta = await fetchMovieMetaFromWeb(id);
      }
      if (meta) {
        db.set(cacheKey, meta, 3600);
      }
      return meta;
    } catch (err) {
      console.error(`[VidLink] getMeta failed for ${id}:`, err);
      return null;
    }
  },

  async resolveMediaItem(id: string, type: string): Promise<MediaItem | null> {
    const prefix = `agg:${SITE_CONFIG.id}:`;
    if (!id.startsWith(prefix)) return null;
    const tmdbId = id.slice(prefix.length);
    const getMetaFn = this.getMeta;
    if (!getMetaFn) return null;
    const meta = await getMetaFn.call(this, tmdbId, type);
    if (!meta) return null;
    return {
      id,
      type: type as any,
      title: meta.name,
      aliases: meta.aliases,
      year: meta.year,
    };
  },

  async getStreams(item: MediaItem): Promise<Stream[]> {
    let movieId = item.id.startsWith(`agg:${SITE_CONFIG.id}:`)
      ? item.id.slice(`agg:${SITE_CONFIG.id}:`.length)
      : undefined;

    if (!movieId) {
      if (!item.title) return [];
      const getCatalogFn = this.getCatalog;
      if (!getCatalogFn) return [];
      const candidates = await getCatalogFn.call(this, 'movie', { search: item.title });
      if (candidates.length === 0) return [];
      const candidate = candidates[0];
      if (!candidate.id.startsWith(`agg:${SITE_CONFIG.id}:`)) return [];
      movieId = candidate.id.slice(`agg:${SITE_CONFIG.id}:`.length);
    }

    const moviePage = `${SITE_CONFIG.baseUrl}/movie/${movieId}`;
    try {
      const res = await axios.get(moviePage, { headers: DEFAULT_HEADERS, timeout: 15000, validateStatus: () => true });
      const streams: Stream[] = [];
      if (res.status === 200) {
        const $ = cheerio.load(res.data);
        const embedUrls = new Set<string>();
        $('iframe').each((_, el) => {
          const src = $(el).attr('src');
          if (src) embedUrls.add(src.startsWith('//') ? `https:${src}` : src);
        });

        for (const url of Array.from(embedUrls).slice(0, 3)) {
          const resolved = await resolveEmbed(url, {
            siteUrl: SITE_CONFIG.baseUrl,
            serverLabel: SITE_CONFIG.name,
            providerName: SITE_CONFIG.name,
          });
          if (resolved) streams.push(resolved);
        }
      }

      if (streams.length > 0) return streams;

      const resolved = await resolveEmbed(moviePage, {
        siteUrl: SITE_CONFIG.baseUrl,
        serverLabel: SITE_CONFIG.name,
        providerName: SITE_CONFIG.name,
      });
      return resolved ? [resolved] : [];
    } catch (err) {
      console.error(`[VidLink] getStreams failed for ${moviePage}:`, err);
      return [];
    }
  }
};

export default vidlinkProvider;
