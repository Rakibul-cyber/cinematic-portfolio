import "server-only";

/**
 * A credential that cannot be printed by accident.
 *
 * `String()`, template literals, `JSON.stringify`, and `console.log`/`util.inspect`
 * all render "[redacted]". The value is reachable only through `reveal()`, so
 * every use of a raw secret is explicit and easy to find in review.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return "[redacted]";
  }

  toJSON(): string {
    return "[redacted]";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "Secret([redacted])";
  }
}
