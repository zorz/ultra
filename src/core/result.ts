/**
 * Result Type
 *
 * A discriminated union type for representing operations that can succeed or fail.
 * Inspired by Rust's Result type, this provides a type-safe alternative to
 * throwing exceptions or returning null for error cases.
 *
 * @example
 * // Function that returns a Result
 * async function saveDocument(doc: Document): Promise<Result<void, SaveError>> {
 *   try {
 *     await doc.save();
 *     return Result.ok(undefined);
 *   } catch (e) {
 *     return Result.err(new SaveError(e.message));
 *   }
 * }
 *
 * // Using the result
 * const result = await saveDocument(doc);
 * if (result.success) {
 *   console.log('Saved successfully');
 * } else {
 *   console.error('Failed:', result.error);
 * }
 */

/**
 * Success result with a value
 */
export interface Ok<T> {
  readonly success: true;
  readonly value: T;
}

/**
 * Failure result with an error
 */
export interface Err<E> {
  readonly success: false;
  readonly error: E;
}

/**
 * Result type - either Ok with a value or Err with an error
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/**
 * Result utility functions
 */
export const Result = {
  /**
   * Create a success result
   *
   * @param value - The success value
   * @returns An Ok result containing the value
   *
   * @example
   * return Result.ok({ id: 123, name: 'test' });
   */
  ok<T>(value: T): Ok<T> {
    return { success: true, value };
  },

  /**
   * Create a failure result
   *
   * @param error - The error value
   * @returns An Err result containing the error
   *
   * @example
   * return Result.err(new Error('File not found'));
   */
  err<E>(error: E): Err<E> {
    return { success: false, error };
  },

  /**
   * Check if a result is Ok
   *
   * @param result - The result to check
   * @returns true if the result is Ok
   */
  isOk<T, E>(result: Result<T, E>): result is Ok<T> {
    return result.success;
  },

  /**
   * Check if a result is Err
   *
   * @param result - The result to check
   * @returns true if the result is Err
   */
  isErr<T, E>(result: Result<T, E>): result is Err<E> {
    return !result.success;
  },

  /**
   * Transform the success value of a Result
   *
   * @param result - The result to transform
   * @param fn - Function to apply to the success value
   * @returns A new Result with the transformed value
   *
   * @example
   * const result = Result.ok(5);
   * const doubled = Result.map(result, x => x * 2); // Ok(10)
   */
  map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return result.success
      ? Result.ok(fn(result.value))
      : result;
  },

  /**
   * Transform the error value of a Result
   *
   * @param result - The result to transform
   * @param fn - Function to apply to the error value
   * @returns A new Result with the transformed error
   */
  mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
    return result.success
      ? result
      : Result.err(fn(result.error));
  },

  /**
   * Chain Result-returning operations
   *
   * @param result - The result to chain from
   * @param fn - Function that returns another Result
   * @returns The chained Result
   *
   * @example
   * const result = Result.ok(5);
   * const chained = Result.flatMap(result, x =>
   *   x > 0 ? Result.ok(x * 2) : Result.err('Must be positive')
   * );
   */
  flatMap<T, U, E>(result: Result<T, E>, fn: (value: T) => Result<U, E>): Result<U, E> {
    return result.success ? fn(result.value) : result;
  },

  /**
   * Transform the success value asynchronously
   *
   * @param result - The result to transform
   * @param fn - Async function to apply to the success value
   * @returns A Promise of the new Result
   */
  async mapAsync<T, U, E>(
    result: Result<T, E>,
    fn: (value: T) => Promise<U>
  ): Promise<Result<U, E>> {
    return result.success
      ? Result.ok(await fn(result.value))
      : result;
  },

  /**
   * Chain Result-returning async operations
   *
   * @param result - The result to chain from
   * @param fn - Async function that returns another Result
   * @returns A Promise of the chained Result
   */
  async flatMapAsync<T, U, E>(
    result: Result<T, E>,
    fn: (value: T) => Promise<Result<U, E>>
  ): Promise<Result<U, E>> {
    return result.success ? fn(result.value) : result;
  },

  /**
   * Get the success value or a default
   *
   * @param result - The result
   * @param defaultValue - Value to return if result is Err
   * @returns The success value or the default
   *
   * @example
   * const result = Result.err('oops');
   * const value = Result.unwrapOr(result, 42); // 42
   */
  unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
    return result.success ? result.value : defaultValue;
  },

  /**
   * Get the success value or compute a default
   *
   * @param result - The result
   * @param fn - Function to compute default from error
   * @returns The success value or the computed default
   */
  unwrapOrElse<T, E>(result: Result<T, E>, fn: (error: E) => T): T {
    return result.success ? result.value : fn(result.error);
  },

  /**
   * Get the success value or throw the error
   *
   * @param result - The result
   * @returns The success value
   * @throws The error if result is Err
   */
  unwrap<T, E>(result: Result<T, E>): T {
    if (result.success) {
      return result.value;
    }
    throw result.error;
  },

  /**
   * Convert a Result to an optional value
   *
   * @param result - The result
   * @returns The success value or undefined
   */
  toOptional<T, E>(result: Result<T, E>): T | undefined {
    return result.success ? result.value : undefined;
  },

  /**
   * Wrap a throwing function in a Result
   *
   * @param fn - Function that might throw
   * @returns Result containing return value or caught error
   *
   * @example
   * const result = Result.try(() => JSON.parse(jsonString));
   */
  try<T>(fn: () => T): Result<T, Error> {
    try {
      return Result.ok(fn());
    } catch (e) {
      return Result.err(e instanceof Error ? e : new Error(String(e)));
    }
  },

  /**
   * Wrap an async throwing function in a Result
   *
   * @param fn - Async function that might throw
   * @returns Promise of Result containing return value or caught error
   */
  async tryAsync<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
    try {
      return Result.ok(await fn());
    } catch (e) {
      return Result.err(e instanceof Error ? e : new Error(String(e)));
    }
  },

  /**
   * Combine multiple Results into a single Result containing an array
   * Short-circuits on first error
   *
   * @param results - Array of Results to combine
   * @returns Result containing array of values, or first error
   *
   * @example
   * const results = [Result.ok(1), Result.ok(2), Result.ok(3)];
   * const combined = Result.all(results); // Ok([1, 2, 3])
   */
  all<T, E>(results: Result<T, E>[]): Result<T[], E> {
    const values: T[] = [];
    for (const result of results) {
      if (!result.success) {
        return result;
      }
      values.push(result.value);
    }
    return Result.ok(values);
  },
};

/**
 * Operation result for commands that may succeed or fail with an error message
 */
export interface OperationResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Git operation result type
 */
export interface GitResult {
  success: boolean;
  error?: string;
}

export default Result;
