export interface ICopySelectionFrame {
  /** Selection text captured by the renderer, used when the pane swallowed the drag. */
  text?: string
  type: 'copy-selection'
}

export interface ISelectionTextFrame {
  text: string
  type: 'selection-text'
}
