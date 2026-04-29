import axios from 'axios';
import { config } from '../config';
import { db } from '../utils/db';
import { MediaItem } from '../types';

export class MetadataService {
  private tmdb = axios.create({
    baseURL: 'https://api.themoviedb.org/3',
    params: { api_key: config.TMDB_API_KEY }
  });

  public async getMeta(id: string, type: string): Promise<MediaItem | null> {
    const baseId = id.split(':')[0];
    const cached = this.getFromCache(baseId);
    if (cached) return { ...cached };

    let meta: MediaItem | null = null;
    if (baseId.startsWith('tt')) {
      meta = await this.fetchCinemeta(baseId, type);
      if (!meta) {
        meta = await this.fetchTMDBByImdb(baseId, type);
      }
    } else if (baseId.startsWith('bgm')) {
      meta = await this.fetchBangumi(baseId.replace('bgm', ''));
    } else if (baseId.startsWith('tmdb')) {
      meta = await this.fetchTMDBById(baseId.replace('tmdb', ''), type);
    } else if (/^\d+$/.test(baseId)) {
      meta = await this.fetchTMDBById(baseId, type);
    }

    if (meta) {
      this.saveToCache(baseId, meta);
    }
    return meta;
  }

  private async fetchCinemeta(imdbId: string, type: string): Promise<MediaItem | null> {
    try {
      const cinemetaType = type === 'movie' ? 'movie' : 'series';
      const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${cinemetaType}/${imdbId}.json`, { timeout: 5000 });
      if (!res.data || !res.data.meta) return null;

      const data = res.data.meta;
      const aliases = new Set<string>();
      if (data.name) aliases.add(data.name);
      if (data.originalName) aliases.add(data.originalName);
      if (data.title) aliases.add(data.title);
      if (data.originalTitle) aliases.add(data.originalTitle);
      if (Array.isArray(data.alternativeTitles)) {
        for (const alt of data.alternativeTitles) {
          if (typeof alt === 'string' && alt) aliases.add(alt);
        }
      }

      const title = data.name || data.title || '';
      return {
        id: imdbId,
        type: cinemetaType,
        name: title,
        title: title,
        tmdbid: data.tmdb_id?.toString() || data.tmdbId?.toString(),
        imdbid: imdbId,
        aliases: Array.from(aliases),
        year: data.year ? Number(data.year) : undefined
      };
    } catch (err: any) {
      if (err.response?.status === 404) {
        console.warn(`[MetadataService] Cinemeta: ${imdbId} not found (404)`);
      } else {
        console.warn(`[MetadataService] Cinemeta fetch failed for ${imdbId}:`, err.message);
      }
      return null;
    }
  }

  private async fetchTMDBByImdb(imdbId: string, type: string): Promise<MediaItem | null> {
    try {
      const findRes = await this.tmdb.get(`/find/${imdbId}`, { params: { external_source: 'imdb_id' } });
      const results = type === 'movie' ? findRes.data.movie_results : findRes.data.tv_results;
      if (!results || results.length === 0) return null;

      const item = results[0];
      const title = item.title || item.name;
      const originalTitle = item.original_title || item.original_name;

      const aliases = new Set<string>();
      if (title) aliases.add(title);
      if (originalTitle) aliases.add(originalTitle);

      try {
        const altPath = type === 'movie' ? `/movie/${item.id}/alternative_titles` : `/tv/${item.id}/alternative_titles`;
        const altRes = await this.tmdb.get(altPath);
        const altTitles = altRes.data.titles || altRes.data.results || [];
        for (const alt of altTitles) {
          if (alt.title && (alt.iso_3166_1 === 'CN' || alt.iso_3166_1 === 'US' || alt.iso_3166_1 === 'GB')) {
            aliases.add(alt.title);
          }
        }
      } catch (err) {
        console.warn(`[MetadataService] Could not fetch alternative titles for ${imdbId}`);
      }

      return {
        id: imdbId,
        type: type as 'movie' | 'series',
        name: title,
        title,
        tmdbid: item.id?.toString(),
        imdbid: imdbId,
        aliases: Array.from(aliases),
        year: new Date(item.release_date || item.first_air_date).getFullYear()
      };
    } catch (err) {
      console.error(`[MetadataService] TMDB Error:`, err);
      return null;
    }
  }

  private async fetchTMDBById(tmdbId: string, type: string): Promise<MediaItem | null> {
    try {
      const itemRes = await this.tmdb.get(type === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`, {
        params: { append_to_response: 'external_ids,alternative_titles' }
      });
      const item = itemRes.data;
      if (!item) return null;

      const title = item.title || item.name;
      const originalTitle = item.original_title || item.original_name;

      const aliases = new Set<string>();
      if (title) aliases.add(title);
      if (originalTitle) aliases.add(originalTitle);

      const altTitles = item.alternative_titles?.titles || item.alternative_titles?.results || [];
      for (const alt of altTitles) {
        if (alt.title && (alt.iso_3166_1 === 'CN' || alt.iso_3166_1 === 'US' || alt.iso_3166_1 === 'GB')) {
          aliases.add(alt.title);
        }
      }

      const imdbId = item.external_ids?.imdb_id || item.imdb_id;

      return {
        id: `tmdb${tmdbId}`,
        type: type as 'movie' | 'series',
        name: title,
        title,
        tmdbid: tmdbId,
        imdbid: imdbId,
        aliases: Array.from(aliases),
        poster: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
        background: `https://image.tmdb.org/t/p/original${item.backdrop_path}`,
        description: item.overview,
        year: item.release_date || item.first_air_date ? new Date(item.release_date || item.first_air_date).getFullYear() : undefined
      };
    } catch (err) {
      console.error(`[MetadataService] TMDB ID fetch failed for ${tmdbId}:`, err);
      return null;
    }
  }

  public async getTMDBId(imdbId: string, type: string): Promise<string | null> {
    try {
      if (config.TMDB_API_KEY) {
        const findRes = await this.tmdb.get(`/find/${imdbId}`, { params: { external_source: 'imdb_id' } });
        const results = type === 'movie' ? findRes.data.movie_results : findRes.data.tv_results;
        if (results && results.length > 0) {
          return results[0].id.toString();
        }
      }

      const cmData = await this.fetchCinemetaRaw(imdbId);
      if (cmData) {
        return cmData.tmdb_id?.toString() || cmData.tmdbId?.toString() || null;
      }

      return null;
    } catch (err) {
      console.error(`[MetadataService] TMDB ID lookup failed for ${imdbId}:`, err);
      return null;
    }
  }

  private async fetchCinemetaRaw(imdbId: string): Promise<any | null> {
    try {
      const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${imdbId}`);
      return res.data;
    } catch {
      return null;
    }
  }

  private async fetchBangumi(bgmId: string): Promise<MediaItem | null> {
    try {
      const res = await axios.get(`${config.BANGUMI_API_URL}/v0/subjects/${bgmId}`);
      const title = res.data.name_cn || res.data.name;
      const aliases = new Set<string>();
      if (res.data.name) aliases.add(res.data.name);
      if (res.data.name_cn) aliases.add(res.data.name_cn);

      return {
        id: `bgm${bgmId}`,
        type: 'series',
        name: title,
        title: title,
        aliases: Array.from(aliases),
        year: res.data.date ? new Date(res.data.date).getFullYear() : undefined
      };
    } catch (err) {
      console.error(`[MetadataService] Bangumi Error:`, err);
      return null;
    }
  }

  private getFromCache(id: string): MediaItem | null {
    return db.get(id) as MediaItem | null;
  }

  private saveToCache(id: string, data: MediaItem) {
    const ttl = data.type === 'movie' ? 24 * 3600 : 6 * 3600;
    db.set(id, data, ttl);
  }
}

export const metadataService = new MetadataService();
