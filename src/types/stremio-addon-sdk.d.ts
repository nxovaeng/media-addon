declare module 'stremio-addon-sdk' {
    export interface Manifest {
        id: string;
        version: string;
        name: string;
        description?: string;
        resources: (string | { name: string; types: string[]; idPrefixes?: string[] })[];
        types: string[];
        idPrefixes?: string[];
        catalogs: any[];
        background?: string;
        logo?: string;
        contactEmail?: string;
        behaviorHints?: {
            configurable?: boolean;
            configurationRequired?: boolean;
            [key: string]: any;
        };
    }

    export interface MetaStandard {
        id: string;
        type: string;
        name: string;
        genres?: string[];
        poster?: string;
        posterShape?: 'square' | 'poster' | 'landscape';
        background?: string;
        logo?: string;
        description?: string;
        releaseInfo?: string;
        director?: string[];
        cast?: string[];
        imdbRating?: string;
        released?: string;
        trailers?: any[];
        links?: { name: string; category: string; url: string }[];
        videos?: VideoStandard[];
        runtime?: string;
        language?: string;
        country?: string;
        awards?: string;
        website?: string;
        behaviorHints?: {
            defaultVideoId?: string;
            [key: string]: any;
        };
    }

    export interface VideoStandard {
        id: string;
        title: string;
        released: string;
        thumbnail?: string;
        streams?: StreamStandard[];
        available?: boolean;
        episode?: number;
        season?: number;
        trailers?: any[];
        overview?: string;
    }

    export interface StreamStandard {
        url?: string;
        ytId?: string;
        infoHash?: string;
        fileIdx?: number;
        name?: string;
        description?: string;
        headers?: Record<string, string>;
        subtitles?: SubtitleStandard[];
        behaviorHints?: {
            notWebReady?: boolean;
            proxyHeaders?: {
                request?: Record<string, string>;
            };
            [key: string]: any;
        };
    }

    export interface SubtitleStandard {
        id: string; // REQUIRED by protocol
        url: string;
        lang: string;
    }

    export class addonBuilder {
        constructor(manifest: Manifest);
        defineStreamHandler(handler: (args: { type: string; id: string; config?: any }) => Promise<{ streams: StreamStandard[]; cacheMaxAge?: number }>): void;
        defineMetaHandler(handler: (args: { type: string; id: string; config?: any }) => Promise<{ meta: MetaStandard | null; cacheMaxAge?: number }>): void;
        defineCatalogHandler(handler: (args: { type: string; id: string; extra: any; config?: any }) => Promise<{ metas: MetaStandard[]; cacheMaxAge?: number }>): void;
        defineSubtitlesHandler(handler: (args: { type: string; id: string; extra?: any; config?: any }) => Promise<{ subtitles: SubtitleStandard[]; cacheMaxAge?: number }>): void;
        getInterface(): any;
    }

    export function serveHTTP(addonInterface: any, options: { port: number; cacheMaxAge?: number; static?: string }): void;
}
