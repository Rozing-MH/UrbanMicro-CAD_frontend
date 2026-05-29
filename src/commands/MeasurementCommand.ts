/**
 * @file 测量命令 (FR1.9 MEASURE 工具)
 * 记录两点测距结果，支持撤销/重做
 * 撤销时移除场景中的测量标注视觉对象
 */

import type { ICommand } from '@/types/commands'
import type { Point2D } from '@/types/road-network'

export interface MeasurementResult {
  fromNodeId: string | null
  toNodeId: string | null
  fromPosition: Point2D
  toPosition: Point2D
  distance: number
  fromElevation: number
  toElevation: number
}

export class MeasurementCommand implements ICommand {
  readonly timestamp = Date.now()
  private result: MeasurementResult | null = null

  constructor(
    private readonly _result: MeasurementResult,
    private readonly onAdd: (result: MeasurementResult) => void,
    private readonly onRemove: (result: MeasurementResult) => void,
  ) {}

  execute(): void {
    this.result = this._result
    this.onAdd(this.result)
  }

  undo(): void {
    if (this.result) this.onRemove(this.result)
  }

  getDescription(): string {
    return `测量距离: ${this._result.distance.toFixed(1)}m`
  }
}
