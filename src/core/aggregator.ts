import { getProvidersByType, movieProviders, seriesProviders } from './providerRegistry';
import { metadataService } from './metadataService';
import { wrapProxyUrl } from '../utils/mediaflow';
import { db } from '../utils/db';
import { MediaItem, Stream, Meta, Provider } from '../types';

export class Aggregator {
  constructor(private providers: Provider[]) {}

  public async getStreams(type: string, id: string): Promise<Stream[]> {
    const cached = this.getFromCache(`streams:${id}`);
    if (cached) return cached;

    let mediaItem: MediaItem;

    if (id.startsWith('agg:')) {
      const afterAgg = id.slice('agg:'.length);
      const colonIdx = afterAgg.indexOf(':');
      if (colonIdx === -1) return [];
      const providerId = afterAgg.slice(0, colonIdx);

      const provider = this.providers.find(p => p.id === providerId);
      if (!provider || !provider.resolveMediaItem) return [];

      const resolved = await provider.resolveMediaItem(id, type).catch(() => null);
      if (!resolved) return [];
      mediaItem = resolved;
    } else {
      const meta = await metadataService.getMeta(id, type);
      if (!meta) return [];

      mediaItem = { ...meta } as MediaItem;
      if (type !== 'movie') {
        const idParts = id.split(':');
        if (idParts.length > 2) {
          mediaItem.season = parseInt(idParts[1]) || 1;
          mediaItem.episode = parseInt(idParts[2]) || 1;
        }
      }
    }

    const streamPromises = this.providers.map(async (p) => {
      try {
        const streams = await p.getStreams(mediaItem);
        return streams.map(s => {
          if (s.url && s.headers) {
            return {
              ...s,
              url: wrapProxyUrl(s.url, s.headers)
            };
          }
          return s;
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[Aggregator] Provider ${p.id} failed:`, message);
        return [];
      }
    });

    const results = await Promise.all(streamPromises);
    const flattened = results.flat();

    const filtered = flattened.filter(s => {
      const match = s.name?.match(/\[(\d+)p/);
      if (match) {
        const res = parseInt(match[1]);
        return res >= 720;
      }
      return true;
    });

    const sorted = filtered.sort((a, b) => {
      const getRes = (name: string) => {
        const match = name.match(/\[(\d+)p/);
        return match ? parseInt(match[1]) : 0;
      };
      const resA = getRes(a.name || '');
      const resB = getRes(b.name || '');

      if (resA !== resB) return resB - resA;
      if ((a.name || '').includes('4K')) return -1;
      if ((b.name || '').includes('4K')) return 1;
      return 0;
    });

    if (sorted.length > 0) {
      this.saveToCache(`streams:${id}`, sorted);
    }

    return sorted;
  }

  public async getCatalog(type: string, id: string, extra: any): Promise<Meta[]> {
    if (extra?.search) {
      const catalogPromises = this.providers.map(async (p) => {
        if (p.getCatalog) {
          try {
            return await p.getCatalog(type, extra);
          } catch (err) {
            console.error(`[Aggregator] Provider ${p.id} catalog failed:`, err);
            return [];
          }
        }
        return [];
      });

      const results = await Promise.all(catalogPromises);
      const flattened = results.flat();
      const seen = new Set<string>();
      return flattened.filter(m => {
        if (seen.has(m.name)) return false;
        seen.add(m.name);
        return true;
      });
    }

    if (id === 'donghua_hot') {
      const provider = this.providers.find(p => p.id === 'donghuaworld');
      if (provider?.getCatalog) {
        try {
          return await provider.getCatalog(type, extra);
        } catch (err) {
          console.error(`[Aggregator] DonghuaWorld catalog failed:`, err);
          return [];
        }
      }
      return [];
    }

    if (id === 'tmdb_popular') {
      const provider = this.providers.find(p => p.id === 'vidlink');
      if (provider?.getCatalog) {
        try {
          return await provider.getCatalog(type, extra);
        } catch (err) {
          console.error(`[Aggregator] VidLink catalog failed:`, err);
          return [];
        }
      }
      return [];
    }

    return [];
  }

  public async getMeta(type: string, id: string): Promise<Meta | null> {
    const cached = db.get(`meta:${id}`) as Meta | null;
    if (cached) return cached;

    if (id.startsWith('agg:')) {
      const afterAgg = id.slice('agg:'.length);
      const colonIdx = afterAgg.indexOf(':');
      if (colonIdx === -1) return null;
      const providerId = afterAgg.slice(0, colonIdx);
      const internalId = afterAgg.slice(colonIdx + 1);

      const provider = this.providers.find(p => p.id === providerId);
      if (provider?.getMeta) {
        try {
          const meta = await provider.getMeta(internalId, type);
          if (meta) db.set(`meta:${id}`, meta, 3600);
          return meta;
        } catch (err) {
          console.error(`[Aggregator] Provider ${providerId} getMeta failed:`, err);
          return null;
        }
      }
    }

    return null;
  }

  private getFromCache(id: string): Stream[] | null {
    return db.get(id) as Stream[] | null;
  }

  private saveToCache(id: string, data: Stream[]) {
    db.set(id, data, 3600);
  }
}

export const movieAggregator = new Aggregator(getProvidersByType('movie'));
export const seriesAggregator = new Aggregator(getProvidersByType('series'));

export function getAggregatorByType(type: string): Aggregator {
  return type === 'movie' ? movieAggregator : seriesAggregator;
}

export function getAggregatorByProviderId(providerId: string): Aggregator | null {
  if (movieProviders.some(p => p.id === providerId)) return movieAggregator;
  if (seriesProviders.some(p => p.id === providerId)) return seriesAggregator;
  return null;
}
