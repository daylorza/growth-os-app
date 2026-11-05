/**
 * Optional personal workspace in the gitignored `private/` folder at the repo root.
 * A fresh clone has none of these files and falls back to the fictional sample creator.
 * Set VITE_IGNORE_PRIVATE=1 to preview the public sample even when private data exists.
 */
import type { TikTokSnapshot } from './tiktok'
import type { AppState } from './types'

const ignore = import.meta.env.VITE_IGNORE_PRIVATE === '1'
const json = import.meta.glob<unknown>(['../../../private/workspace.json', '../../../private/vault/tiktok/tiktok-snapshot.json'], { eager: true, import: 'default' })
const raw = import.meta.glob<string>('../../../private/brand/MASTER_AGENT_PROMPT.md', { eager: true, query: '?raw', import: 'default' })

export const PRIVATE_WORKSPACE = ignore ? undefined : (json['../../../private/workspace.json'] as Partial<AppState> | undefined)
export const PRIVATE_TIKTOK = ignore ? undefined : (json['../../../private/vault/tiktok/tiktok-snapshot.json'] as TikTokSnapshot | undefined)
export const PRIVATE_MASTER_PROMPT = ignore ? undefined : raw['../../../private/brand/MASTER_AGENT_PROMPT.md']
export const HAS_PRIVATE_WORKSPACE = !!PRIVATE_WORKSPACE
