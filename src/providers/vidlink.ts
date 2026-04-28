import { Provider, MediaItem, Stream } from '../types';
import { db } from '../utils/db';
import { buildHlsProxyUrl } from '../utils/mediaflow';
import { metadataService } from '../core/metadataService';
import { getTmdbHomeCatalog } from '../core/tmdbHome';

const SITE_CONFIG = {
  id: 'vidlink',
  name: 'VidLink',
  baseUrl: 'https://vidlink.pro',
};

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const vidlinkProvider: Provider = {
  id: SITE_CONFIG.id,
  name: SITE_CONFIG.name,
  enabled: false,
  weight: 80,

  async getStreams(item: MediaItem): Promise<Stream[]> {
    let movieId: string | undefined;

    // Extract ID: Supports plain TMDB ID or IMDB ID (ttxxxx)
    const idParts = item.id.split(':');
    const mainId = idParts[0];

    if (mainId.startsWith('tt')) {
      // Handle IMDB ID
      const tmdbId = await metadataService.getTMDBId(mainId, item.type);
      movieId = tmdbId || undefined;
    } else if (mainId.startsWith('tmdb')) {
      // Handle tmdb prefix
      movieId = mainId.replace('tmdb', '');
    } else if (/^\d+$/.test(mainId)) {
      // Handle plain TMDB ID
      movieId = mainId;
    }

    // Fallback to tmdbid field if available
    if (!movieId && item.tmdbid) {
      movieId = item.tmdbid;
    }

    if (!movieId) {
      const title = item.title || item.name || '';
      if (!title) return [];
      // Fallback to searching TMDB via tmdbHome as a last resort
      const type = (item.type === 'series' || item.type === 'tv') ? 'series' : 'movie';
      try {
        const candidates = await getTmdbHomeCatalog(type, { search: title });
        if (candidates.length > 0) {
          movieId = candidates[0].id;
        }
      } catch (err) {
        console.error(`[VidLink] Failed to search TMDB for ${title}:`, err);
      }
    }

    if (!movieId) {
      console.warn(`[VidLink] Could not resolve TMDB ID for: ${item.title || item.name || item.id}`);
      return [];
    }


    // Resolve VidLink API play url: https://vidlink.pro/movie/{tmdbId}
    try {
      const apiUrl = (item.type === 'series' || item.type === 'tv')
        ? `${SITE_CONFIG.baseUrl}/tv/${movieId}${item.season ? `?season=${item.season}&episode=${item.episode || 1}` : ''}`
        : `${SITE_CONFIG.baseUrl}/movie/${movieId}`;

      const streamUrl = `${apiUrl}.m3u8`;
      const cacheKey = `resolved:vidlink:${streamUrl}`;

      const cached = db.get(cacheKey) as Stream | null;
      if (cached) {
        return [cached];
      }

      // Wrap the VidLink stream URL through proxy for proper header handling
      const proxyUrl = buildHlsProxyUrl(streamUrl, {
        referer: 'https://vidlink.pro/',
        origin: 'https://vidlink.pro',
        userAgent: DEFAULT_USER_AGENT,
        maxRes: true,
      });

      const stream: Stream = {
        url: proxyUrl,
        name: `[Auto] ${SITE_CONFIG.name}`,
        description: 'VidLink · Direct API',
      };

      db.set(cacheKey, stream, 1800); // Cache for 30 minutes
      return [stream];
    } catch (err) {
      console.error(`[VidLink] getStreams failed for ${movieId}:`, err);
      return [];
    }
  }
};

export default vidlinkProvider;
