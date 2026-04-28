import { metadataService } from './metadataService';
import { wrapProxyUrl } from '../utils/mediaflow';
import { db } from '../utils/db';
import { MediaItem, Stream, Meta, Provider, AggregatorConfig, Subtitle } from '../types';
import { getTmdbHomeCatalog } from './tmdbHome';

export class Aggregator {
  public readonly name: string;
  public readonly config: AggregatorConfig;
  private providers: Provider[];

  constructor(name: string, config: AggregatorConfig, providers: Provider[]) {
    this.name = name;
    this.config = config;
    this.providers = providers;
  }

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

  public async getSubtitles(type: string, id: string): Promise<Subtitle[]> {
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
    }

    const subPromises = this.providers.map(async (p) => {
      if ((p as any).getSubtitles) {
        try {
          return await (p as any).getSubtitles(mediaItem);
        } catch (err) {
          console.error(`[Aggregator] Provider ${p.id} subtitles failed:`, err instanceof Error ? err.message : String(err));
          return [];
        }
      }
      return [];
    });

    const results = await Promise.all(subPromises);
    return results.flat();
  }

  public async getCatalog(type: string, id: string, extra: any): Promise<Meta[]> {
    if (extra?.search) {
      const catalogPromises = this.providers.map(async (p) => {
        if (p.getCatalog) {
          try {
            const metas = await p.getCatalog(type, extra);
            const providerName = p.name;
            return metas.map(m => ({
              ...m,
              description: m.description ? `${m.description} · ${providerName}` : providerName,
            }));
          } catch (err) {
            console.error(`[Aggregator] Provider ${p.id} catalog failed:`, err);
            return [];
          }
        }
        return [];
      });

      const results = await Promise.all(catalogPromises);
      return results.flat();
    }

    if (id === this.name) {
      const homeSource = this.config.homeSource || 'provider';
      if (homeSource === 'tmdb') {
        // Handle TMDB-specific logic
        return await getTmdbHomeCatalog('movie', extra);
      } else if (homeSource === 'douban') {
        // Handle Douban-specific logic
        return await getTmdbHomeCatalog('series', extra);
      } else {
        // Default: aggregate from providers
        const provider = this.providers[0]
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
    return db.get(`${this.name}:streams:${id}`) as Stream[] | null;
  }

  private saveToCache(id: string, data: Stream[]) {
    db.set(`${this.name}:streams:${id}`, data, 3600);
  }

  public getEnabledProviders(): Provider[] {
    return this.providers
      .filter((p) => p.enabled);
  }
}

/**
 * 命名聚合器实例
 * 由 providerRegistry 初始化，支持跨地域的不同聚合策略
 */
let aggregators: Map<string, Aggregator> = new Map();

/**
 * 注册一个聚合器
 */
export function registerAggregator(name: string, config: AggregatorConfig, providers: Provider[]) {
  const agg = new Aggregator(name, config, providers);
  aggregators.set(name, agg);
  console.log(`[Aggregator] Registered aggregator: ${name} (${config.displayName})`);
  return agg;
}

/**
 * 根据名称获取聚合器
 */
export function getAggregatorByName(name: string): Aggregator | null {
  return aggregators.get(name) || null;
}

/**
 * 获取所有聚合器
 */
export function getAllAggregators(): Aggregator[] {
  return Array.from(aggregators.values());
}

/**
 * 根据内容类型和地域获取默认聚合器
 */
export function getDefaultAggregator(type: 'movie' | 'series', region?: 'mainland' | 'overseas' | 'auto'): Aggregator | null {
  const candidates = Array.from(aggregators.values()).filter(agg => {
    const configMatches = agg.config.supportedTypes.includes(type);
    const regionMatches = !region || region === 'auto' || agg.config.region === 'auto' || agg.config.region === region;
    return configMatches && regionMatches;
  });

  if (candidates.length === 0) return null;

  // 按优先级排序，返回最高优先级的
  candidates.sort((a, b) => (b.config.priority || 0) - (a.config.priority || 0));
  return candidates[0];
}

/**
 * 根据供应商 ID 获取聚合器
 */
export function getAggregatorByProviderId(providerId: string): Aggregator | null {
  for (const agg of aggregators.values()) {
    if (agg.config.providerIds?.includes(providerId)) {
      return agg;
    }
  }
  return null;
}

/**
 * 向后兼容的函数 - 根据类型获取聚合器（会返回默认的）
 */
export function getAggregatorByType(type: string): Aggregator | null {
  return getDefaultAggregator(type as 'movie' | 'series') ||
    getDefaultAggregator(type as 'movie' | 'series', 'auto');
}

