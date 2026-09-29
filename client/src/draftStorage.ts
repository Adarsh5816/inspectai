// Draft & Local Session Storage Manager for Zero-Data-Loss
const DRAFT_PREFIX = 'inspectai_draft_';

export function saveDraft<T>(key: string, data: T): void {
  try {
    const payload = {
      data,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('inspectai_draft_updated'));
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
    window.dispatchEvent(new CustomEvent('inspectai_draft_updated'));
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
              data: parsed.data
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
