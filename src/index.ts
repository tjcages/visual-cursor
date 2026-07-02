import type { Plugin } from "vite";
import { clickToSourceStamp, type StampOptions } from "./stamp";
import { cursorAgent, type AgentOptions } from "./agent";

export { clickToSourceStamp, type StampOptions } from "./stamp";
export { cursorAgent, type AgentOptions } from "./agent";

export type VisualCursorOptions = StampOptions & AgentOptions;

/**
 * The full Visual Cursor Vite setup: the `data-loc` stamping transform plus
 * the `/__agent`, `/__undo`, `/__redo` dev-server middleware. Spread into your
 * `plugins` array — put it before your framework's own plugin(s) so its
 * `enforce: "pre"` transform runs first.
 *
 * @example
 * ```ts
 * import { visualCursor } from "visual-cursor";
 *
 * export default defineConfig({
 *   plugins: [...visualCursor({ sourceDir: "src" }), react()],
 * });
 * ```
 */
export function visualCursor(options: VisualCursorOptions = {}): Plugin[] {
  return [cursorAgent(options), clickToSourceStamp(options)];
}
