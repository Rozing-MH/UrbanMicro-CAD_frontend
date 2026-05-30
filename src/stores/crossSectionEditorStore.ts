import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CrossSectionProfile, LaneDef, MedianDef, SidewalkDef, LaneType, LaneDirection } from '@/types/road-network'
import { templateApi } from '@/api/templateApi'
import { registerCrossSectionProfiles } from '@/utils/roadProfiles'
import { useRoadNetworkStore } from '@/stores/roadNetworkStore'
import { useEditorStateStore } from '@/stores/editorStateStore'
import { SetCrossSectionCommand } from '@/commands/roadCommands'
import { historyStack } from '@/commands/HistoryStack'

export const useCrossSectionEditorStore = defineStore('crossSectionEditor', () => {
  const targetSegmentId = ref<string | null>(null)
  const profile = ref<CrossSectionProfile | null>(null)
  const previewDirty = ref(false)
  const profileName = ref('')

  const isEditing = computed(() => targetSegmentId.value !== null || profile.value !== null)

  const forwardLaneCount = computed(() =>
    profile.value?.lanes.filter(l => l.direction === 'FORWARD' || l.direction === 'BOTH').length ?? 0,
  )

  const backwardLaneCount = computed(() =>
    profile.value?.lanes.filter(l => l.direction === 'BACKWARD' || l.direction === 'BOTH').length ?? 0,
  )

  function getForwardLaneCount(): number {
    return forwardLaneCount.value
  }

  function getBackwardLaneCount(): number {
    return backwardLaneCount.value
  }

  function startEditing(initialProfile: CrossSectionProfile | null, segmentId?: string): void {
    targetSegmentId.value = segmentId ?? null
    if (initialProfile) {
      profile.value = {
        ...initialProfile,
        id: `custom-${Date.now().toString(36)}`,
        lanes: initialProfile.lanes.map((l, i) => ({ ...l, id: `cl${i}` })),
        median: { ...initialProfile.median },
        sidewalk: { ...initialProfile.sidewalk },
      }
      profileName.value = initialProfile.name
    } else {
      profile.value = {
        id: `custom-${Date.now().toString(36)}`,
        name: '自定义断面',
        lanes: [
          { id: 'cl0', width: 3.5, type: 'CAR' as LaneType, direction: 'FORWARD' as LaneDirection },
          { id: 'cl1', width: 3.5, type: 'CAR' as LaneType, direction: 'BACKWARD' as LaneDirection },
        ],
        median: { width: 0, type: 'NONE' },
        sidewalk: { leftWidth: 1.5, rightWidth: 1.5, hasCurb: true },
        totalWidth: 8,
      }
      profileName.value = ''
    }
    previewDirty.value = false
  }

  function reset(): void {
    targetSegmentId.value = null
    profile.value = null
    profileName.value = ''
    previewDirty.value = false
  }

  function addLane(direction: LaneDirection = 'BACKWARD', type: LaneType = 'CAR', width: number = 3.5): void {
    if (!profile.value) return
    const lanes = [...profile.value.lanes, { id: `cl${profile.value.lanes.length}`, width, type, direction }]
    updateLanes(lanes)
  }

  function removeLane(index: number): void {
    if (!profile.value) return
    const target = profile.value.lanes[index]
    if (!target) return

    const remaining = profile.value.lanes.filter((_, i) => i !== index)
    const fwd = remaining.filter(l => l.direction === 'FORWARD' || l.direction === 'BOTH').length
    const bwd = remaining.filter(l => l.direction === 'BACKWARD' || l.direction === 'BOTH').length
    if (fwd < 1 || bwd < 1) {
      throw new Error('至少保留1条正向车道和1条反向车道')
    }

    updateLanes(remaining)
  }

  function updateLane(index: number, updates: Partial<LaneDef>): void {
    if (!profile.value || index < 0 || index >= profile.value.lanes.length) return
    const lanes = profile.value.lanes.map((l, i) => i === index ? { ...l, ...updates } : l)
    updateLanes(lanes)
  }

  function updateMedian(patch: Partial<MedianDef>): void {
    if (!profile.value) return
    profile.value = { ...profile.value, median: { ...profile.value.median, ...patch } }
    previewDirty.value = true
    recalcTotalWidth()
  }

  function updateSidewalk(patch: Partial<SidewalkDef>): void {
    if (!profile.value) return
    profile.value = { ...profile.value, sidewalk: { ...profile.value.sidewalk, ...patch } }
    previewDirty.value = true
    recalcTotalWidth()
  }

  function setProfileName(name: string): void {
    profileName.value = name
  }

  function buildProfile(): CrossSectionProfile | null {
    if (!profile.value) return null
    return {
      ...profile.value,
      name: profileName.value.trim() || '自定义断面',
      totalWidth: calcTotalWidth(profile.value.lanes, profile.value.median, profile.value.sidewalk),
    }
  }

  function applyToSegment(segmentId: string): void {
    const p = buildProfile()
    if (!p) throw new Error('无可应用的断面')

    const editorState = useEditorStateStore()
    const sessionId = editorState.historySessionId
    if (!sessionId) throw new Error('无活跃编辑会话')

    const cmd = new SetCrossSectionCommand(segmentId, p)
    historyStack.execute(cmd, sessionId)
    registerCrossSectionProfiles([p])
    editorState.setActiveProfile(p.id)

    const roadStore = useRoadNetworkStore()
    roadStore.setActiveCrossSection(p.id)
  }

  async function saveAsTemplate(name: string): Promise<void> {
    const p = buildProfile()
    if (!p) throw new Error('无可保存的断面')

    const saved: CrossSectionProfile = {
      ...p,
      id: `user-${Date.now().toString(36)}`,
      name: name.trim(),
    }

    await templateApi.saveCrossSection({
      name: saved.name,
      category: 'CUSTOM',
      profile: saved,
    })

    registerCrossSectionProfiles([saved])

    const editorState = useEditorStateStore()
    editorState.setActiveProfile(saved.id)

    const roadStore = useRoadNetworkStore()
    roadStore.setActiveCrossSection(saved.id)
  }

  function updateLanes(lanes: LaneDef[]): void {
    if (!profile.value) return
    profile.value = { ...profile.value, lanes }
    previewDirty.value = true
    recalcTotalWidth()
  }

  function recalcTotalWidth(): void {
    if (!profile.value) return
    profile.value = { ...profile.value, totalWidth: calcTotalWidth(profile.value.lanes, profile.value.median, profile.value.sidewalk) }
  }

  function calcTotalWidth(lanes: LaneDef[], median: MedianDef, sidewalk: SidewalkDef): number {
    let w = lanes.reduce((sum, l) => sum + l.width, 0)
    if (median.type !== 'NONE') w += median.width
    w += sidewalk.leftWidth + sidewalk.rightWidth
    return w
  }

  return {
    targetSegmentId, profile, previewDirty, profileName, isEditing,
    forwardLaneCount, backwardLaneCount,
    startEditing, reset, addLane, removeLane, updateLane,
    updateMedian, updateSidewalk, setProfileName,
    buildProfile, applyToSegment, saveAsTemplate,
    getForwardLaneCount, getBackwardLaneCount,
  }
})
