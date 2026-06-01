export interface ICommand {
  execute(): void | Promise<void>
  undo(): void
  getDescription(): string
  readonly timestamp: number
}

/** Extended command that supports async execute with automatic rollback on failure.
 * When execute() rejects, the HistoryStack will automatically call undo() to revert
 * any partial Store mutations, then surface the error to the user. */
export interface IAsyncCommand extends ICommand {
  execute(): Promise<void>
}

export interface CommandHistoryEntry {
  command: ICommand
  description: string
  timestamp: number
}
