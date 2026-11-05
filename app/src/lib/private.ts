/**
 * Personal data for this browser session. Nothing private is bundled: the server reads it at request time
 * (local mode: the gitignored `private/` folder, see workspace.server.ts; endpoint mode: the Growth OS API)
 * and hands it to the client through props. A fresh clone has none and shows the fictional sample creator.
 */
import type { TikTokSnapshot } from './tiktok'
import type { AppState } from './types'

export interface PrivateData {
  workspace?: Partial<AppState>
  tiktok?: TikTokSnapshot
  masterPrompt?: string
}

let data: PrivateData = {}

export const setPrivateData = (d: PrivateData) => {
  data = d
}

export const privateWorkspace = () => data.workspace
export const privateTikTok = () => data.tiktok
export const privateMasterPrompt = () => data.masterPrompt
export const hasPrivateWorkspace = () => !!data.workspace
