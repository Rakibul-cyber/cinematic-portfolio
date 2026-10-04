import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import {
  TURNSTILE_SCRIPT_URL,
  loadTurnstile,
  type TurnstileApi,
} from "@/lib/security/turnstile-widget";

type ScriptEvent = "error" | "load";

class FakeScript {
  async = false;
  removed = false;
  src = "";
  private listeners = new Map<ScriptEvent, () => void>();

  addEventListener(event: ScriptEvent, listener: () => void) {
    this.listeners.set(event, listener);
  }

  dispatch(event: ScriptEvent) {
    this.listeners.get(event)?.();
  }

  remove() {
    this.removed = true;
  }
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let appendedScripts: FakeScript[];

function installBrowser(turnstile?: TurnstileApi) {
  appendedScripts = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { turnstile },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (tag: string) => {
        assert.equal(tag, "script");
        return new FakeScript();
      },
      head: {
        append: (script: FakeScript) => appendedScripts.push(script),
      },
    },
  });
}

function restoreGlobal(name: "document" | "window", descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

describe("Turnstile script loader", () => {
  beforeEach(() => installBrowser());

  after(() => {
    restoreGlobal("document", originalDocument);
    restoreGlobal("window", originalWindow);
  });

  it("rejects when the script loads without exposing window.turnstile", async () => {
    const loading = loadTurnstile();
    assert.equal(appendedScripts.length, 1);

    appendedScripts[0].dispatch("load");

    await assert.rejects(loading, /loaded without exposing its API/);
  });

  it("rejects and removes the script when loading fails", async () => {
    const loading = loadTurnstile();
    const script = appendedScripts[0];

    script.dispatch("error");

    await assert.rejects(loading, /script failed to load/);
    assert.equal(script.removed, true);
  });

  it("resolves directly with the API and deduplicates concurrent loads", async () => {
    let readyCalls = 0;
    const api = {
      render: () => "widget-id",
      reset: () => {},
      remove: () => {},
      ready: () => {
        readyCalls += 1;
      },
    } as TurnstileApi & { ready: () => void };

    const first = loadTurnstile();
    const second = loadTurnstile();
    assert.equal(appendedScripts.length, 1);
    assert.equal(appendedScripts[0].src, TURNSTILE_SCRIPT_URL);
    assert.equal(appendedScripts[0].async, true);

    window.turnstile = api;
    appendedScripts[0].dispatch("load");

    assert.equal(await first, api);
    assert.equal(await second, api);
    assert.equal(readyCalls, 0);
  });
});
