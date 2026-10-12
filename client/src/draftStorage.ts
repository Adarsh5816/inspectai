// Draft & Local Session Storage Manager for Zero-Data-Loss
const DRAFT_PREFIX = 'inspectai_draft_';
const OPEN_WINDOW_PREFIX = 'inspectai_open_window_';
const ACTIVE_WINDOWS_KEY = 'inspectai_active_windows_registry';

export interface OpenWindowState {
  windowId: string;       // e.g. 'edit_details', 'add_item', 'edit_item', etc.
  contextId: string;      // e.g. inspectionId or projectId
  data?: any;             // in-progress form values or object
  timestamp: string;
}

// -------------------------------------------------------------
// Form Draft Management
// -------------------------------------------------------------

export function saveDraft<T>(key: string, data: T): void {
  try {
    const payload = {
      data,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('inspectai_draft_updated', { detail: { key, payload } }));
  } catch (err) {
    console.warn('Failed to save draft to localStorage:', err);
  }
}

export function loadDraft<T>(key: string): { data: T; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + key);
    window.dispatchEvent(new CustomEvent('inspectai_draft_updated', { detail: { key, payload: null } }));
  } catch (err) {
    console.warn('Failed to remove draft from localStorage:', err);
  }
}

export function getAllDrafts(): { key: string; savedAt: string; data: any }[] {
  const drafts: { key: string; savedAt: string; data: any }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (storageKey && storageKey.startsWith(DRAFT_PREFIX)) {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            drafts.push({
              key: storageKey.replace(DRAFT_PREFIX, ''),
              savedAt: parsed.savedAt,
              data: parsed.data,
            });
          } catch {}
        }
      }
    }
  } catch {}
  return drafts;
}

export function hasActiveDrafts(): boolean {
  return getAllDrafts().length > 0;
}

// -------------------------------------------------------------
// Open Window & Modal State Persistence
// -------------------------------------------------------------

function getRegistry(): Record<string, OpenWindowState> {
  try {
    const raw = localStorage.getItem(ACTIVE_WINDOWS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setRegistry(reg: Record<string, OpenWindowState>): void {
  try {
    localStorage.setItem(ACTIVE_WINDOWS_KEY, JSON.stringify(reg));
  } catch (err) {
    console.warn('Failed to set window registry:', err);
  }
}

export function saveOpenWindow(contextKey: string, windowId: string, data?: any): void {
  try {
    const payload: OpenWindowState = {
      windowId,
      contextId: contextKey,
      data,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem(OPEN_WINDOW_PREFIX + contextKey, JSON.stringify(payload));

    const reg = getRegistry();
    reg[contextKey] = payload;
    setRegistry(reg);

    window.dispatchEvent(new CustomEvent('inspectai_window_state_changed', { detail: payload }));
    window.dispatchEvent(new CustomEvent('inspectai_draft_updated'));
  } catch (err) {
    console.warn('Failed to save open window:', err);
  }
}

export function getOpenWindow(contextKey: string): OpenWindowState | null {
  try {
    const raw = localStorage.getItem(OPEN_WINDOW_PREFIX + contextKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearOpenWindow(contextKey: string): void {
  try {
    localStorage.removeItem(OPEN_WINDOW_PREFIX + contextKey);
    const reg = getRegistry();
    delete reg[contextKey];
    setRegistry(reg);

    window.dispatchEvent(new CustomEvent('inspectai_window_state_changed', { detail: null }));
    window.dispatchEvent(new CustomEvent('inspectai_draft_updated'));
  } catch (err) {
    console.warn('Failed to clear open window:', err);
  }
}

export function getAllOpenWindows(): OpenWindowState[] {
  const reg = getRegistry();
  return Object.values(reg);
}

// -------------------------------------------------------------
// Global Flush & Broadcast Dispatcher
// -------------------------------------------------------------

export function flushAllOpenDrafts(): void {
  try {
    window.dispatchEvent(new CustomEvent('inspectai_flush_drafts'));
  } catch (err) {
    console.warn('Failed to dispatch flush event:', err);
  }
}
