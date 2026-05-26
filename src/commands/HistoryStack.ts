import type { ICommand } from '@/types/commands'

const MAX_HISTORY = 50

export class HistoryStack {
  private stack: ICommand[] = []
  private pointer = -1
  private onChange?: (pointer: number, length: number) => void

  setOnChange(cb: (pointer: number, length: number) => void): void {
    this.onChange = cb
  }

  async execute(command: ICommand): Promise<void> {
    // Discard redo history beyond current pointer
    this.stack.splice(this.pointer + 1)
    await command.execute()
    this.stack.push(command)
    if (this.stack.length > MAX_HISTORY) {
      this.stack.shift()
    }
    this.pointer = this.stack.length - 1
    this.notify()
  }

  async undo(): Promise<void> {
    if (this.pointer < 0) return
    await this.stack[this.pointer].undo()
    this.pointer--
    this.notify()
  }

  async redo(): Promise<void> {
    if (this.pointer >= this.stack.length - 1) return
    this.pointer++
    await this.stack[this.pointer].execute()
    this.notify()
  }

  canUndo(): boolean {
    return this.pointer >= 0
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1
  }

  clear(): void {
    this.stack = []
    this.pointer = -1
    this.notify()
  }

  getDescription(): string {
    if (this.pointer < 0) return ''
    return this.stack[this.pointer].getDescription()
  }

  private notify(): void {
    this.onChange?.(this.pointer, this.stack.length)
  }
}

export const historyStack = new HistoryStack()
