/**
 * An expected, user-facing failure (bad input the schema can't catch, a
 * business rule, "not enough stock"). Actions turn it into a form error;
 * anything else is a bug and is logged.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what = "Item") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}
