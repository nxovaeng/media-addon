export interface MediaItem {
  id: string;
  type: 'movie' | 'series' | 'channel' | 'tv';
  title: string;
  aliases?: string[];
  year?: number;
  season?: number;
  episode?: number;
}

export interface Stream {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  description?: string;
  headers?: Record<string, string>;
  behaviorHints?: {
    notWebReady?: boolean;
    proxyHeaders?: {
      request?: Record<string, string>;
    };
    [key: string]: any;
  };
}

export interface MetaLink {
  name: string;
  category: string;
  url: string;
}

export interface Video {
  id: string;
  title: string;
  released: string;
  thumbnail?: string;
  streams?: Stream[];
  available?: boolean;
  episode?: number;
  season?: number;
  trailers?: Stream[];
  overview?: string;
}

export interface Meta {
  id: string;
  type: string;
  name: string;
  aliases?: string[];
  poster?: string;
  posterShape?: 'poster' | 'landscape' | 'square';
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  released?: string;
  trailers?: Stream[];
  links?: MetaLink[];
  videos?: Video[];
  runtime?: string;
  language?: string;
  country?: string;
  year?: number;
  awards?: string;
  website?: string;
  behaviorHints?: {
    defaultVideoId?: string;
    [key: string]: any;
  };
}

export interface Manifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  resources: string[];
  types: string[];
  idPrefixes?: string[];
  catalogs: Array<{
    type: string;
    id: string;
    name: string;
    extra?: Array<{
      name: string;
      isRequired?: boolean;
      options?: string[];
    }>;
  }>;
}

export interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  weight?: number;
  maxStreams?: number;
  getStreams(item: MediaItem): Promise<Stream[]>;
  search?(query: string, type: string): Promise<MediaItem[]>;
  getCatalog?(type: string, extra: any): Promise<Meta[]>;
  getMeta?(id: string, type: string): Promise<Meta | null>;
  /**
   * Given an agg: stream ID originating from this provider, resolve it into
   * a MediaItem (title, aliases, episode, season) so other providers can
   * search for the same content. Called by the aggregator before fanning out
   * getStreams to all providers.
   */
  resolveMediaItem?(id: string, type: string): Promise<MediaItem | null>;
}
