import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config';
import { Meta } from '../types';

const SITE_CONFIG = {
  tmdbOrg: 'https://www.themoviedb.org',
  tmdbImageBase: 'https://image.tmdb.org/t/p/w500',
};

const tmdb = axios.create({
  baseURL: 'https://api.themoviedb.org/3',
  params: { 
    api_key: config.TMDB_API_KEY,
    language: 'zh-CN'
  }
});

function buildImageUrl(path: string | undefined): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${SITE_CONFIG.tmdbImageBase}${path}`;
}

function extractAliases(item: any, type: string): string[] {
  const aliases = new Set<string>();
  if (item.title) aliases.add(item.title);
  if (item.name) aliases.add(item.name);
  if (item.original_title) aliases.add(item.original_title);
  if (item.original_name) aliases.add(item.original_name);

  if (Array.isArray(item.alternative_titles?.titles || item.alternative_titles?.results)) {
    const titles = item.alternative_titles?.titles || item.alternative_titles?.results;
    for (const alt of titles) {
      if (alt.title) aliases.add(alt.title);
      if (alt.name) aliases.add(alt.name);
    }
  }

  return Array.from(aliases);
}

function buildMovieMeta(item: any): Meta {
  const name = item.title || item.name || 'Unknown Movie';
  const mark = item.origin_country && item.origin_country.length > 0 ? `[${item.origin_country[0]}] ` : '[TMDB] ';
  return {
    id: `tmdb${item.id}`,
    type: 'movie' as const,
    name: `${mark}${name}`,
    title: name,
    poster: buildImageUrl(item.poster_path || item.poster),
    background: buildImageUrl(item.backdrop_path || item.backdrop),
    description: item.overview || '',
    year: item.release_date ? new Date(item.release_date).getFullYear() : undefined,
    aliases: extractAliases(item, 'movie'),
  };
}

function buildTvMeta(item: any): Meta {
  const name = item.name || item.title || 'Unknown Series';
  const mark = item.origin_country && item.origin_country.length > 0 ? `[${item.origin_country[0]}] ` : '[TMDB] ';
  return {
    id: `tmdb${item.id}`,
    type: 'series' as const,
    name: `${mark}${name}`,
    title: name,
    poster: buildImageUrl(item.poster_path || item.poster),
    background: buildImageUrl(item.backdrop_path || item.backdrop),
    description: item.overview || '',
    year: item.first_air_date ? new Date(item.first_air_date).getFullYear() : undefined,
    aliases: extractAliases(item, 'series'),
  };
}

// ─── Web Scraping Fallbacks ──────────────────────────────────────────────────

function parseTmdbFromHtml(html: string, type: 'movie' | 'series', maxItems = 20): Meta[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const metas: Meta[] = [];
  const linkPrefix = type === 'movie' ? '/movie/' : '/tv/';

  $(`a[href^="${linkPrefix}"]`).each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(new RegExp(`^${linkPrefix}(\\d+)`));
    if (!match) return;
    const tmdbId = match[1];
    if (seen.has(tmdbId)) return;
    seen.add(tmdbId);

    const title = $(el).attr('title') || $(el).find('img').attr('alt') || $(el).text().trim();
    if (!title) return;

    metas.push({
      id: `tmdb${tmdbId}`,
      type: type as 'movie' | 'series',
      name: `[TMDB] ${title}`,
      title: title,
      poster: buildImageUrl($(el).find('img').attr('src') || $(el).find('img').attr('data-src')),
      posterShape: 'poster',
    });

    if (metas.length >= maxItems) return false;
  });

  return metas;
}

export async function getTmdbHomeCatalog(type: 'movie' | 'series', extra: any): Promise<Meta[]> {
  const page = extra?.skip ? Math.floor(extra.skip / 20) + 1 : 1;
  const regionName = extra?.genre;
  
  const regionMap: Record<string, string> = {
    '中国大陆': 'CN',
    '中国香港': 'HK',
    '中国台湾': 'TW',
    '美国': 'US',
    '日本': 'JP',
    '韩国': 'KR'
  };
  const regionCode = regionName ? regionMap[regionName] : null;
  
  try {
    let endpoint = type === 'movie' ? '/movie/popular' : '/tv/popular';
    const params: any = { page };

    if (regionCode) {
      endpoint = type === 'movie' ? '/discover/movie' : '/discover/tv';
      params.with_origin_country = regionCode;
      params.sort_by = 'popularity.desc';
    }

    const res = await tmdb.get(endpoint, { params });
    
    if (res.data && Array.isArray(res.data.results)) {
      return res.data.results.map((item: any) => type === 'movie' ? buildMovieMeta(item) : buildTvMeta(item));
    }
  } catch (err) {
    console.warn(`[TMDB Home] API failed, falling back to scraping:`, err instanceof Error ? err.message : String(err));
  }

  try {
    const url = `${SITE_CONFIG.tmdbOrg}/${type === 'movie' ? 'movie' : 'tv'}?language=zh-CN`;
    const res = await axios.get(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    return parseTmdbFromHtml(res.data, type);
  } catch (err) {
    console.error(`[TMDB Home] Scraping also failed:`, err);
    return [];
  }
}
