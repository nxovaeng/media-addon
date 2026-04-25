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
      meta = await this.fetchTMDB(baseId, type);
    } else if (baseId.startsWith('bgm')) {
      meta = await this.fetchBangumi(baseId.replace('bgm', ''));
    }

    if (meta) {
      this.saveToCache(baseId, meta);
    }
    return meta;
  }

  private async fetchTMDB(imdbId: string, type: string): Promise<MediaItem | null> {
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
        title: title,
        aliases: Array.from(aliases),
        year: new Date(item.release_date || item.first_air_date).getFullYear()
      };
    } catch (err) {
      console.error(`[MetadataService] TMDB Error:`, err);
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
