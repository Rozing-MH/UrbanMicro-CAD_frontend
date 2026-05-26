export interface ICommand {
  execute(): void | Promise<void>
  undo(): void | Promise<void>
  getDescription(): string
  readonly timestamp: number
}

export interface CommandHistoryEntry {
  command: ICommand
  description: string
  timestamp: number
}
