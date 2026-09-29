/** A failure the handlers pass to the client as `status` + `{ error: message }`. */
export class SourceError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
