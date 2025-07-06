const verboseLogging = true;

type EventType = string | symbol;

// An event handler can take an optional event argument
// and should not return a value
type Handler<T = unknown> = (event: T) => void;
type WildcardHandler<T = Record<string, unknown>> = (
  type: keyof T,
  event: T[keyof T],
) => void;

// An array of all currently registered event handlers for a type
type EventHandlerList<T = unknown> = Array<Handler<T>>;
type WildCardEventHandlerList<T = Record<string, unknown>> = Array<
  WildcardHandler<T>
>;

// Based on https://github.com/developit/mitt but changed to a class
export class EventEmitter<Events extends Record<EventType, unknown>> {
  all = new Map();

  /**
   * Register an event handler for the given type.
   * @param {string|symbol} type Type of event to listen for, or `'*'` for all events
   * @param {Function} handler Function to call in response to given event
   * @memberOf mitt
   */
  on<Key extends keyof Events>(
    type: Key,
    handler: Handler<Events[keyof Events]>,
  ) {
    const handlers: Handler<Events[keyof Events]>[] | undefined =
      this.all.get(type);
    if (handlers) {
      handlers.push(handler);
    } else {
      this.all.set(type, [handler] as EventHandlerList<Events[keyof Events]>);
    }
  }

  /**
   * Remove an event handler for the given type.
   * If `handler` is omitted, all handlers of the given type are removed.
   * @param type Type of event to unregister `handler` from (`'*'` to remove a wildcard handler)
   * @param handler Handler function to remove
   * @memberOf mitt
   */
  off<Key extends keyof Events>(
    type: Key,
    handler?: Handler<Events[keyof Events]>,
  ) {
    const handlers: Array<Handler<Events[keyof Events]>> = this.all.get(type);
    if (handlers) {
      if (handler) {
        handlers.splice(handlers.indexOf(handler) >>> 0, 1);
      } else {
        this.all.set(type, []);
      }
    }
  }

  /**
   * Invoke all handlers for the given type.
   * If present, `'*'` handlers are invoked after type-matched handlers.
   *
   * Note: Manually firing '*' handlers is not supported.
   *
   * @param type The event type to invoke
   * @param event Any value (object is recommended and powerful), passed to each handler
   * @memberOf mitt
   */
  emit<Key extends keyof Events>(type: Key, event?: Events[Key]) {
    let handlers = this.all.get(type);
    if (handlers) {
      (handlers as EventHandlerList<Events[keyof Events]>)
        .slice()
        .map((handler) => {
          handler(event!);
        });
    }

    handlers = this.all.get("*");
    if (handlers) {
      (handlers as WildCardEventHandlerList<Events>).slice().map((handler) => {
        handler(type, event!);
      });
    }
  }
}

export const nonZero = (x: unknown): x is NonNullable<typeof x> =>
  x !== (undefined || null || "" || 0);

export const log = (function log() {
  if (!verboseLogging) {
    return function noop() {};
  }
  const context = "GODIRECT:";
  return Function.prototype.bind.call(console.log, console, context);
})();

export const dir = (function dir() {
  if (!verboseLogging) {
    return function noop() {};
  }
  return Function.prototype.bind.call(console.dir, console);
})();

export function bufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

export function appendBuffer(buffer1: ArrayBuffer, buffer2: ArrayBuffer) {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
}
