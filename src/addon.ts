import { addonBuilder } from 'stremio-addon-sdk';
import { getAggregatorByName, getAggregatorByType, getAggregatorByProviderId } from './core/aggregator';
import { getEnabledAggregatorConfigs } from './core/providerRegistry';
import { metadataService } from './core/metadataService';
import { allowedAccessTokens } from './config';

const manifest = {
  id: 'community.aggregator.node',
  version: '1.0.3',
  name: '聚合搜索 (Node)',
  description: '提供动漫、电影、电视剧的优质在线源聚合',
  resources: [
    'stream',
    'meta',
    'catalog',
    'subtitles'
  ],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'bgm', 'tmdb', 'agg:'],
  catalogs: getEnabledAggregatorConfigs().flatMap(config =>
    config.supportedTypes.map(type => ({
      type: type,
      id: config.name,
      name: config.displayName,
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    }))
  ),

  behaviorHints: {
    configurable: false,
    configurationRequired: false,
  },
  config: [
    {
      key: 'accessToken',
      type: 'password' as const,
      title: '访问 Token',
      required: false,
    }
  ]
};


const builder = new addonBuilder(manifest);

function isValidAccessToken(config: any): boolean {
  if (!Array.isArray(allowedAccessTokens) || allowedAccessTokens.length === 0) {
    return false;
  }
  if (!config || typeof config.accessToken !== 'string') {
    return false;
  }
  return allowedAccessTokens.includes(config.accessToken);
}

builder.defineStreamHandler(async (args: any) => {
  const { type, id, config } = args;
  console.log(`[Addon] Stream request: ${type} ${id}`);
  /*
  if (!isValidAccessToken(config)) {
    console.warn('[Addon] Invalid access token for stream request');
    return { streams: [] };
  }
  */

  let aggregatorRef = getAggregatorByType(type);

  if (!aggregatorRef) {
    console.error(`[Addon] No aggregator found for type: ${type}`);
    return { streams: [] };
  }

  if (id.startsWith('agg:')) {
    const providerId = id.slice('agg:'.length).split(':')[0];
    const providerAgg = getAggregatorByProviderId(providerId);
    if (providerAgg) aggregatorRef = providerAgg;
  }

  const streams = await aggregatorRef.getStreams(type, id);
  return { streams };
});

builder.defineMetaHandler(async ({ type, id, config }) => {
  console.log(`[Addon] Meta request: ${type} ${id}`);

  if (id.startsWith('agg:')) {
    const providerId = id.slice('agg:'.length).split(':')[0];
    const aggregatorRef = getAggregatorByProviderId(providerId) || getAggregatorByType(type);
    if (!aggregatorRef) return { meta: null };
    const meta = await aggregatorRef.getMeta(type, id);
    if (!meta) return { meta: null };
    return { meta };
  }

  const meta = await metadataService.getMeta(id, type);
  if (!meta) return { meta: null };

  // Explicitly return a Protocol-compliant MetaStandard object
  return {
    meta: {
      id: meta.id,
      type: meta.type,
      name: meta.title || meta.name || '', // Map internal title to standard name
      poster: meta.poster || '',
      background: meta.background || '',
      description: meta.description || '',
      releaseInfo: meta.year ? `${meta.year}` : undefined, // Standard year field
      links: meta.imdbid ? [
        {
          name: "IMDb",
          category: "imdb",
          url: `stremio:///detail/${type}/${meta.imdbid}`
        }
      ] : []
    }
  };
});

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log(`[Addon] Catalog request: ${type} ${id} (search: ${extra.search || 'none'})`);

  // Explicit check: Only handle requests intended for our aggregators
  const aggregatorRef = getAggregatorByName(id);

  if (!aggregatorRef) {
    console.warn(`[Addon] Ignored request for unknown catalog: ${id}`);
    return { metas: [] };
  }

  const metas = await aggregatorRef.getCatalog(type, id, extra);

  // Map to Standard Protocol
  return {
    metas: metas.map(m => ({
      id: m.id,
      type: m.type,
      name: m.name || m.title || 'Unknown',
      poster: m.poster,
      background: m.background,
      description: m.description,
      releaseInfo: m.releaseInfo || (m.year ? String(m.year) : undefined),
      links: m.links,
    }))
  };
});

builder.defineSubtitlesHandler(async (args: { type: string, id: string }) => {
  const { type, id } = args;
  console.log(`[Addon] Subtitles request: ${type} ${id}`);

  const aggregatorRef = getAggregatorByType(type as any);
  if (!aggregatorRef) return { subtitles: [] };

  const subtitles = await aggregatorRef.getSubtitles(type, id);
  return { subtitles };
});

export const addonInterface = builder.getInterface();
