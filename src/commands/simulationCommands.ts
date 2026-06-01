import type { ICommand } from '@/types/commands'
import type { ODPair, IDMParams, MOBILParams, VehicleMixConfig } from '@/types/simulation'
import { useSimulationStore } from '@/stores/simulationStore'

// ─── OD Matrix Commands ─────────────────────────────────────

/** Add a blank OD pair */
export class AddODPairCommand implements ICommand {
  readonly timestamp = Date.now()
  private oldPairs: ODPair[] = []

  getDescription(): string {
    return '添加 OD 对'
  }

  execute(): void {
    const sim = useSimulationStore()
    this.oldPairs = [...sim.odMatrix.pairs]
    sim.addODPair()
  }

  undo(): void {
    const sim = useSimulationStore()
    sim.setODMatrix({ pairs: this.oldPairs })
  }
}

/** Remove an OD pair at given index */
export class RemoveODPairCommand implements ICommand {
  readonly timestamp = Date.now()
  private index: number
  private oldPairs: ODPair[] = []

  constructor(index: number) {
    this.index = index
  }

  getDescription(): string {
    return `删除 OD 对 #${this.index + 1}`
  }

  execute(): void {
    const sim = useSimulationStore()
    this.oldPairs = [...sim.odMatrix.pairs]
    sim.removeODPair(this.index)
  }

  undo(): void {
    const sim = useSimulationStore()
    sim.setODMatrix({ pairs: this.oldPairs })
  }
}

/** Update a single OD pair field */
export class UpdateODPairCommand implements ICommand {
  readonly timestamp = Date.now()
  private index: number
  private patch: Partial<ODPair>
  private oldPairs: ODPair[] = []

  constructor(index: number, patch: Partial<ODPair>) {
    this.index = index
    this.patch = patch
  }

  getDescription(): string {
    return `修改 OD 对 #${this.index + 1}`
  }

  execute(): void {
    const sim = useSimulationStore()
    this.oldPairs = [...sim.odMatrix.pairs]
    sim.updateODPair(this.index, this.patch)
  }

  undo(): void {
    const sim = useSimulationStore()
    sim.setODMatrix({ pairs: this.oldPairs })
  }
}

// ─── IDM Params Command ─────────────────────────────────────

/** Update IDM parameters (saves full old state for undo) */
export class SetIDMParamsCommand implements ICommand {
  readonly timestamp = Date.now()
  private patch: Partial<IDMParams>
  private oldParams: IDMParams | null = null

  constructor(patch: Partial<IDMParams>) {
    this.patch = patch
  }

  getDescription(): string {
    return '修改 IDM 参数'
  }

  execute(): void {
    const sim = useSimulationStore()
    this.oldParams = { ...sim.idmParams }
    sim.setIDMParams(this.patch)
  }

  undo(): void {
    if (!this.oldParams) return
    const sim = useSimulationStore()
    sim.setIDMParams(this.oldParams)
  }
}

// ─── MOBIL Params Command ───────────────────────────────────

/** Update MOBIL parameters (saves full old state for undo) */
export class SetMOBILParamsCommand implements ICommand {
  readonly timestamp = Date.now()
  private patch: Partial<MOBILParams>
  private oldParams: MOBILParams | null = null

  constructor(patch: Partial<MOBILParams>) {
    this.patch = patch
  }

  getDescription(): string {
    return '修改 MOBIL 参数'
  }

  undo(): void {
    if (!this.oldParams) return
    const sim = useSimulationStore()
    sim.setMOBILParams(this.oldParams)
  }

  execute(): void {
    const sim = useSimulationStore()
    this.oldParams = { ...sim.mobilParams }
    sim.setMOBILParams(this.patch)
  }
}

// ─── Vehicle Mix Command ────────────────────────────────────

/** Update vehicle type mix ratios */
export class SetVehicleMixCommand implements ICommand {
  readonly timestamp = Date.now()
  private mix: VehicleMixConfig
  private oldMix: VehicleMixConfig | null = null

  constructor(mix: VehicleMixConfig) {
    this.mix = mix
  }

  getDescription(): string {
    return '修改车型比例'
  }

  execute(): void {
    const sim = useSimulationStore()
    this.oldMix = { ...sim.vehicleMix, ratios: [...sim.vehicleMix.ratios] }
    sim.setVehicleMix(this.mix)
  }

  undo(): void {
    if (!this.oldMix) return
    const sim = useSimulationStore()
    sim.setVehicleMix(this.oldMix)
  }
}
