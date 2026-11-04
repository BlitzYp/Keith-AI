import { config } from '../config.js';
import { BrickClient } from './brickClient.js';

/**
 * The music bot, if MUSIC_BOT_KEY is set in .env; null otherwise, and then Keith has no music
 * tools and doesn't duck. One client for the whole bot: it keeps no state between requests.
 */
export const brick: BrickClient | null = config.music.key
  ? new BrickClient({ baseUrl: config.music.baseUrl, key: config.music.key })
  : null;
