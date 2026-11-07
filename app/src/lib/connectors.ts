/**
 * Account connectors. Two ways in, both read-only:
 *
 * 1. Export files: the creator downloads analytics CSVs from the platform and imports them.
 *    Works today for TikTok. Other platforms need a parser built from a real sample export.
 * 2. OAuth: a "Connect" button that goes through a connector server (see `oauth.ts`).
 *    Tokens live on that server only, never in the browser or this repo.
 */
import type { ConnectorId, HandleKey } from './types'

export interface ConnectorDef {
  id: ConnectorId
  name: string
  handlePlaceholder: string
  /** The agent that reads this platform with its own access, and how. Names come from the profile. */
  reader?: { role: 'analyst' | 'creative'; via: string }
  /** A host connector that pulls this platform's counts itself; its snapshots have ids starting with idPrefix. */
  api?: { label: string; idPrefix: string; schedule: string }
  /** More of the creator's accounts on this platform, e.g. a brand account. */
  extraHandles?: { key: HandleKey; label: string }[]
  exportFiles: { status: 'available' | 'needs-sample'; steps: string[] }
  oauth: { api: string; scopes: string[]; note: string }
}

export const CONNECTORS: ConnectorDef[] = [
  {
    id: 'tiktok',
    name: 'TikTok',
    handlePlaceholder: '@yourhandle',
    reader: { role: 'creative', via: 'its signed-in browser: comments, notifications and TikTok Studio views' },
    api: { label: 'TikTok API', idPrefix: 'S-TT-API-', schedule: 'daily at 07:30 UTC' },
    exportFiles: {
      status: 'available',
      steps: [
        'Open TikTok Studio on desktop and go to Analytics.',
        'Download data from each tab: Overview, Content, Viewers and Followers.',
        'Import all the CSVs below (or drop them in private/vault/tiktok/inbox/ and run pnpm tiktok:ingest).',
      ],
    },
    oauth: { api: 'TikTok Display API (Login Kit)', scopes: ['user.info.basic', 'user.info.stats', 'video.list'], note: 'Requires a TikTok developer app approved for these scopes.' },
  },
  {
    id: 'x',
    name: 'X',
    handlePlaceholder: '@yourhandle',
    reader: { role: 'analyst', via: 'its own X access: profile, posts and mentions' },
    exportFiles: { status: 'needs-sample', steps: ['Export your account analytics CSV from X.', 'Send one sample export to add the X parser.'] },
    oauth: { api: 'X API v2 (OAuth 2.0 with PKCE)', scopes: ['tweet.read', 'users.read', 'offline.access'], note: 'Requires an X developer app; API access tiers and limits apply.' },
  },
  {
    id: 'threads',
    name: 'Threads',
    handlePlaceholder: '@yourhandle',
    reader: { role: 'creative', via: 'its Threads connection: profile, insights, replies and messages' },
    exportFiles: { status: 'needs-sample', steps: ['The creative agent records a weekly Threads snapshot after the Sunday refresh request.', 'Send one sample insights export to add a Threads parser.'] },
    oauth: { api: 'Threads API (Meta)', scopes: ['threads_basic', 'threads_manage_insights'], note: 'Requires a Meta app with Threads API access.' },
  },
  {
    id: 'instagram',
    name: 'Instagram',
    handlePlaceholder: '@yourhandle',
    reader: { role: 'creative', via: 'its Instagram connection: comments, DMs and message requests (queue only for now)' },
    extraHandles: [{ key: 'instagram_brand', label: 'Brand handle' }],
    exportFiles: { status: 'needs-sample', steps: ['Export insights from your professional account.', 'Send one sample export to add the Instagram parser.'] },
    oauth: { api: 'Instagram API (professional accounts)', scopes: [], note: 'Read-only insights. Exact scopes depend on the Meta app type.' },
  },
  {
    id: 'youtube',
    name: 'YouTube',
    handlePlaceholder: '@yourchannel',
    exportFiles: { status: 'needs-sample', steps: ['Export a report from YouTube Studio analytics.', 'Send one sample export to add the YouTube parser.'] },
    oauth: { api: 'YouTube Data + Analytics APIs (Google OAuth)', scopes: ['youtube.readonly', 'yt-analytics.readonly'], note: 'Requires a Google Cloud OAuth client.' },
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    handlePlaceholder: 'in/yourname',
    exportFiles: { status: 'needs-sample', steps: ['Export creator analytics from LinkedIn.', 'Send one sample export to add the LinkedIn parser.'] },
    oauth: { api: 'LinkedIn API', scopes: [], note: 'Analytics access requires LinkedIn partner approval.' },
  },
]
