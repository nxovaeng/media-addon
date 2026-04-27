import { addonBuilder } from 'stremio-addon-sdk';
import { movieAggregator, seriesAggregator, getAggregatorByProviderId, getAggregatorByType } from './core/aggregator';
import { metadataService } from './core/metadataService';

const manifest = {
  id: 'community.aggregator.node',
  version: '1.0.0',
  name: '聚合搜索 (Node)',
  description: '支持动漫、电影、电视剧的优质在线源聚合 (DonghuaFun/Donghuaworld/Animekhor/Donghuastream)',
  resources: [
    'stream',
    'meta',
    'catalog'
  ],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'bgm', 'agg:'],
  catalogs: [
    {
      type: 'series',
      id: 'donghua_hot',
      name: '热门国漫',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'movie',
      id: 'tmdb_popular',
      name: 'TMDB 热门电影',
      extra: [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    }
  ]
};


const builder = new addonBuilder(manifest);

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[Addon] Stream request: ${type} ${id}`);
  let aggregatorRef = getAggregatorByType(type);

  if (id.startsWith('agg:')) {
    const providerId = id.slice('agg:'.length).split(':')[0];
    const providerAgg = getAggregatorByProviderId(providerId);
    if (providerAgg) aggregatorRef = providerAgg;
  }

  const streams = await aggregatorRef.getStreams(type, id);
  return { streams };
});

builder.defineMetaHandler(async ({ type, id }) => {
  console.log(`[Addon] Meta request: ${type} ${id}`);

  if (id.startsWith('agg:')) {
    const providerId = id.slice('agg:'.length).split(':')[0];
    const aggregatorRef = getAggregatorByProviderId(providerId) || getAggregatorByType(type);
    const meta = await aggregatorRef.getMeta(type, id);
    if (!meta) return { meta: null };
    return { meta };
  }

  const meta = await metadataService.getMeta(id, type);
  if (!meta) return { meta: null };

  return {
    meta: {
      id: meta.id,
      type: meta.type,
      name: meta.title,
      poster: '',
      background: '',
      description: '',
    }
  };
});

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  console.log(`[Addon] Catalog request: ${type} ${id} ${JSON.stringify(extra)}`);

  let aggregatorRef = getAggregatorByType(type);
  if (id === 'donghua_hot' || id === 'tmdb_popular') {
    aggregatorRef = id === 'tmdb_popular' ? movieAggregator : seriesAggregator;
  }

  if (id === 'donghua_hot' || id === 'tmdb_popular' || (extra && extra.search)) {
    const metas = await aggregatorRef.getCatalog(type, id, extra);
    return { metas };
  }
  return { metas: [] };
});

export const addonInterface = builder.getInterface();
