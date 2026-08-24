import type { EventBus, EventName, GameEvents } from './types';

/** Tiny typed pub/sub bus shared by all subsystems. */
export function createEventBus(): EventBus {
  const listeners = new Map<EventName, Set<(payload: never) => void>>();
  return {
    on(name, fn) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(fn as (payload: never) => void);
      return () => set!.delete(fn as (payload: never) => void);
    },
    emit(name, payload) {
      const set = listeners.get(name);
      if (!set) return;
      for (const fn of set) {
        try {
          (fn as (p: GameEvents[typeof name]) => void)(payload);
        } catch (err) {
          console.error(`[events] listener for "${name}" threw`, err);
        }
      }
    },
  };
}
