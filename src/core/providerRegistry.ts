import animekhorProvider from '../providers/animekhor';
import donghuafunProvider from '../providers/donghuafun';
import donghuastreamProvider from '../providers/donghuastream';
import donghuaworldProvider from '../providers/donghuaworld';
import netmirrorProvider from '../providers/netmirror';
import superstreamProvider from '../providers/superstream';
import vidlinkProvider from '../providers/vidlink';
import { Provider } from '../types';

export const movieProviders: Provider[] = [
  vidlinkProvider,
];

export const seriesProviders: Provider[] = [
  donghuafunProvider,
  donghuastreamProvider,
  donghuaworldProvider,
  animekhorProvider,
  superstreamProvider,
  netmirrorProvider,
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
