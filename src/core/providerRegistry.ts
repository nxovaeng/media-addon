import animekhorProvider from '../providers/animekhor';
import donghuafunProvider from '../providers/donghuafun';
import donghuastreamProvider from '../providers/donghuastream';
import donghuaworldProvider from '../providers/donghuaworld';
import superstreamProvider from '../providers/superstream';

import { Provider, AggregatorConfig } from '../types';
import { registerAggregator } from './aggregator';
import { config, activeAggregators } from '../config';

/**
 * 供应商分类 - 按地域/类型组织
 */
export const movieProviders: Provider[] = [
  superstreamProvider,
];

export const seriesProviders: Provider[] = [
  donghuafunProvider,
  donghuastreamProvider,
  donghuaworldProvider,
  animekhorProvider,
  superstreamProvider,
];

export const providerMap = new Map<string, Provider>(
  [...movieProviders, ...seriesProviders].map((provider) => [provider.id, provider])
);

export function getProvidersByType(type: string): Provider[] {
  return type === 'movie' ? movieProviders : seriesProviders;
}

export function getProviderById(providerId: string): Provider | undefined {
  return providerMap.get(providerId);
}

export function getEnabledAggregatorConfigs(): AggregatorConfig[] {
  if (activeAggregators.length > 0) {
    return aggregatorConfigs.filter((c) => activeAggregators.includes(c.name));
  }

  if (config.REGION === 'all') {
    return [...aggregatorConfigs];
  }

  return aggregatorConfigs.filter((c) =>
    c.region === 'auto' || c.region === config.REGION
  );
}

/**
 * 聚合器配置定义
 * 支持按地域/内容类型/来源进行不同的聚合策略
 */
const aggregatorConfigs: AggregatorConfig[] = [
  {
    name: 'hot-anime',
    displayName: '热门动漫',
    supportedTypes: ['series'],
    providerIds: ['donghuafun', 'donghuastream', 'donghuaworld', 'animekhor'],
    region: 'overseas',
    priority: 100,
  },
  {
    name: 'hot-movies',
    displayName: '海外热门',
    supportedTypes: ['movie', 'series'],
    providerIds: ['superstream'],
    region: 'overseas',
    priority: 100,
    homeSource: 'tmdb',
  }
];

/**
 * 初始化所有聚合器
 */
export function initializeAggregators() {
  const enabledConfigs = getEnabledAggregatorConfigs();

  if (activeAggregators.length > 0) {
    const unknownNames = activeAggregators.filter((name) => !aggregatorConfigs.some((config) => config.name === name));
    if (unknownNames.length > 0) {
      console.warn(`[ProviderRegistry] Unknown active aggregator names: ${unknownNames.join(', ')}`);
    }
  }

  enabledConfigs.forEach(config => {
    const providers = (config.providerIds || [])
      .map(id => providerMap.get(id))
      .filter((p): p is Provider => p !== undefined);

    if (providers.length === 0) {
      console.warn(`[ProviderRegistry] No providers found for aggregator: ${config.name}`);
      return;
    }

    registerAggregator(config.name, config, providers);
  });
}
