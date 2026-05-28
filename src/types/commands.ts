export interface ICommand {
  execute(): void
  undo(): void
  getDescription(): string
  readonly timestamp: number
}

export interface CommandHistoryEntry {
  command: ICommand
  description: string
  timestamp: number
}
