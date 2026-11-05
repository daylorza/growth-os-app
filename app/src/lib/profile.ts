import { useAppState } from './store'
import type { Owner, Profile } from './types'

export const ownerName = (p: Profile, o: Owner) => (o === 'creator' ? p.creatorName : p.agents[o].name)

export const ownerOptions = (p: Profile): Record<Owner, string> => ({
  creator: p.creatorName,
  analyst: p.agents.analyst.name,
  creative: p.agents.creative.name,
})

export function useProfile() {
  const p = useAppState().profile
  return { ...p, owner: (o: Owner) => ownerName(p, o), owners: ownerOptions(p) }
}
