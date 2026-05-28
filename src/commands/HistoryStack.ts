import type { ICommand } from '@/types/commands'

const MAX_HISTORY = 50

export type HistorySessionId = number

type HistoryChangeCallback = (pointer: number, length: number) => void
type HistoryMutationCallback = () => void

type HistoryOperation = (generation: number) => void

export class HistoryStack {
  private stack: ICommand[] = []
  private pointer = -1
  private onChange?: HistoryChangeCallback
  private onMutation?: HistoryMutationCallback
  private operationChain: Promise<void> = Promise.resolve()
  private generation = 0
  private activeSessionId: HistorySessionId | null = null
  private nextSessionId = 1

  setOnChange(cb?: HistoryChangeCallback): void {
    this.onChange = cb
  }

  setOnMutation(cb?: HistoryMutationCallback): void {
    this.onMutation = cb
  }

  clearCallbacks(): void {
    this.onChange = undefined
    this.onMutation = undefined
  }

  startSession(): HistorySessionId {
    const sessionId = this.nextSessionId
    this.nextSessionId++
    this.activeSessionId = sessionId
    return sessionId
  }

  endSession(sessionId: HistorySessionId): void {
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null
      this.generation++
    }
  }

  isSessionActive(sessionId: HistorySessionId): boolean {
    return this.activeSessionId === sessionId
  }

  execute(command: ICommand, sessionId: HistorySessionId): Promise<void> {
    return this.enqueue(sessionId, (generation) => {
      command.execute()
      if (generation !== this.generation) return
      this.stack.splice(this.pointer + 1)
      this.stack.push(command)
      if (this.stack.length > MAX_HISTORY) {
        this.stack.shift()
      }
      this.pointer = this.stack.length - 1
      this.notify()
      this.notifyMutation()
    })
  }

  undo(sessionId: HistorySessionId): Promise<void> {
    return this.enqueue(sessionId, (generation) => {
      if (this.pointer < 0) return
      const command = this.stack[this.pointer]
      command.undo()
      if (generation !== this.generation) return
      this.pointer--
      this.notify()
      this.notifyMutation()
    })
  }

  redo(sessionId: HistorySessionId): Promise<void> {
    return this.enqueue(sessionId, (generation) => {
      if (this.pointer >= this.stack.length - 1) return
      const nextPointer = this.pointer + 1
      const command = this.stack[nextPointer]
      command.execute()
      if (generation !== this.generation) return
      this.pointer = nextPointer
      this.notify()
      this.notifyMutation()
    })
  }

  canUndo(): boolean {
    return this.pointer >= 0
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1
  }

  clear(): void {
    this.generation++
    this.stack = []
    this.pointer = -1
    this.notify()
  }

  getDescription(): string {
    if (this.pointer < 0) return ''
    return this.stack[this.pointer].getDescription()
  }

  private enqueue(
    sessionId: HistorySessionId,
    operation: HistoryOperation,
  ): Promise<void> {
    const generation = this.generation
    const run = (): void => {
      if (!this.isSessionActive(sessionId) || generation !== this.generation) return
      operation(generation)
    }
    const result = this.operationChain.then(run, run)
    this.operationChain = result.catch(() => undefined)
    return result
  }

  private notify(): void {
    this.onChange?.(this.pointer, this.stack.length)
  }

  private notifyMutation(): void {
    this.onMutation?.()
  }
}

export const historyStack = new HistoryStack()
