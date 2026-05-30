import type { CrossSectionProfile } from '@/types/road-network'

export const DEFAULT_PROFILE: CrossSectionProfile = {
  id: 'default-2lane',
  name: 'Default 2-lane road',
  lanes: [
    { id: 'l1', width: 3.5, type: 'CAR', direction: 'FORWARD' },
    { id: 'l2', width: 3.5, type: 'CAR', direction: 'BACKWARD' },
  ],
  median: { width: 0, type: 'NONE' },
  sidewalk: { leftWidth: 1.5, rightWidth: 1.5, hasCurb: true },
  totalWidth: 8,
}

export const BUILT_IN_PROFILES: CrossSectionProfile[] = [
  DEFAULT_PROFILE,
  {
    id: 'arterial-4lane-bus',
    name: '4-lane arterial with bus lanes',
    lanes: [
      { id: 'l1', width: 3.5, type: 'BUS', direction: 'FORWARD' },
      { id: 'l2', width: 3.5, type: 'CAR', direction: 'FORWARD' },
      { id: 'l3', width: 3.5, type: 'CAR', direction: 'BACKWARD' },
      { id: 'l4', width: 3.5, type: 'BUS', direction: 'BACKWARD' },
    ],
    median: { width: 1.5, type: 'GRASS' },
    sidewalk: { leftWidth: 2, rightWidth: 2, hasCurb: true },
    totalWidth: 19.5,
  },
]

const profileRegistry = new Map<string, CrossSectionProfile>(
  BUILT_IN_PROFILES.map((profile) => [profile.id, profile]),
)

export function registerCrossSectionProfiles(profiles: CrossSectionProfile[]): void {
  for (const profile of profiles) {
    profileRegistry.set(profile.id, profile)
  }
}

export function getProfileById(id: string | null | undefined): CrossSectionProfile {
  if (!id) return DEFAULT_PROFILE
  return profileRegistry.get(id) ?? DEFAULT_PROFILE
}

