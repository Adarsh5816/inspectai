import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import * as API from './api';
import { getAllDrafts, getAllOpenWindows, flushAllOpenDrafts } from './draftStorage';

export const CLIENT_VERSION = 'v1.3.1';

function isServerNewer(serverVer: string, clientVer: string): boolean {
  if (!serverVer || !clientVer) return false;
  if (serverVer === clientVer) return false;
  const sParts = serverVer.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const cParts = clientVer.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(sParts.length, cParts.length); i++) {
    const s = sParts[i] || 0;
    const c = cParts[i] || 0;
    if (s > c) return true;
    if (s < c) return false;
  }
  return false;
}

function getSessionId(): string {
  let sid = sessionStorage.getItem('inspectai_session_id');
  if (!sid) {
    sid = 'sess_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
    sessionStorage.setItem('inspectai_session_id', sid);
  }
  return sid;
}

export function DeploymentGuardian({ user }: { user: any }) {
  const location = useLocation();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [serverVersion, setServerVersion] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [openWindowsCount, setOpenWindowsCount] = useState(0);
  const [lastSavedNotice, setLastSavedNotice] = useState<string | null>(null);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const sessionId = useRef(getSessionId()).current;

  // Check draft count and active windows
  const updateStatus = () => {
    const drafts = getAllDrafts();
    const windows = getAllOpenWindows();
    setDraftCount(drafts.length);
    setOpenWindowsCount(windows.length);
  };

  useEffect(() => {
    updateStatus();
    const handleDraftUpdate = () => {
      updateStatus();
      setLastSavedNotice(new Date().toLocaleTimeString());
      setTimeout(() => setLastSavedNotice(null), 3500);
    };

    window.addEventListener('inspectai_draft_updated', handleDraftUpdate);
    window.addEventListener('inspectai_window_state_changed', handleDraftUpdate);
    window.addEventListener('storage', handleDraftUpdate);
    return () => {
      window.removeEventListener('inspectai_draft_updated', handleDraftUpdate);
      window.removeEventListener('inspectai_window_state_changed', handleDraftUpdate);
      window.removeEventListener('storage', handleDraftUpdate);
    };
  }, []);

  // Flush drafts and prevent accidental tab closing if unsaved changes exist
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      flushAllOpenDrafts();
      const hasWork = draftCount > 0 || openWindowsCount > 0;
      if (hasWork) {
        e.preventDefault();
        e.returnValue = 'You have active in-progress work. Your inputs have been backed up locally. Are you sure you want to close?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [draftCount, openWindowsCount]);

  // Heartbeat loop every 20 seconds
  useEffect(() => {
    let isMounted = true;

    const runHeartbeat = async () => {
      try {
        const totalUnsaved = draftCount + openWindowsCount;
        const res = await API.sendHeartbeat({
          sessionId,
          userId: user?.id,
          userName: user?.fullName || 'User',
          userEmail: user?.email,
          currentPath: location.pathname,
          hasUnsavedChanges: totalUnsaved > 0,
          unsavedFormsCount: totalUnsaved,
          clientVersion: CLIENT_VERSION,
        });

        if (isMounted && res.data) {
          if (res.data.serverVersion && isServerNewer(res.data.serverVersion, CLIENT_VERSION)) {
            setUpdateAvailable(true);
            setServerVersion(res.data.serverVersion);
          } else {
            setUpdateAvailable(false);
          }
        }
      } catch {
        // Silent fail for network blip
      }
    };

    runHeartbeat();
    const interval = setInterval(runHeartbeat, 20000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [sessionId, user, location.pathname, draftCount, openWindowsCount]);

  const handleSaveAndRefresh = () => {
    setIsApplyingUpdate(true);
    flushAllOpenDrafts();
    setTimeout(() => {
      // Force clean reload busting browser HTML/script cache
      const url = new URL(window.location.href);
      url.searchParams.set('_v', Date.now().toString());
      window.location.replace(url.toString());
    }, 250);
  };

  const hasUnsaved = draftCount > 0 || openWindowsCount > 0;

  if (!updateAvailable || dismissed) {
    if (lastSavedNotice) {
      return (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white text-xs px-3.5 py-2 rounded-xl shadow-xl flex items-center gap-2.5 border border-slate-700 animate-fade-in backdrop-blur-md">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Draft &amp; active windows auto-saved locally at <strong>{lastSavedNotice}</strong></span>
        </div>
      );
    }
    return null;
  }

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-3 shadow-xl border-b text-sm transition-all animate-slide-down ${
      hasUnsaved 
        ? 'bg-amber-500 text-amber-950 border-amber-600' 
        : 'bg-indigo-600 text-white border-indigo-700'
    }`}>
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 font-medium">
          <span className="text-2xl">{hasUnsaved ? '🛡️' : '🚀'}</span>
          <div>
            <div className="font-bold flex items-center gap-2">
              <span>{hasUnsaved ? 'New System Patch Detected' : 'New Version Ready'}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-black/15 font-mono">{serverVersion || 'Latest'}</span>
            </div>
            <div className="text-xs opacity-95">
              {hasUnsaved ? (
                <span>
                  You have <strong className="underline">{draftCount} form draft(s)</strong> and <strong className="underline">{openWindowsCount} active window(s)</strong> in progress. They are preserved in local storage and will automatically reopen after applying this update.
                </span>
              ) : (
                <span>An application update is available to apply.</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hasUnsaved ? (
            <>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                disabled={isApplyingUpdate}
                className="px-3.5 py-1.5 bg-amber-200/90 hover:bg-amber-100 text-amber-950 font-semibold rounded-lg text-xs transition border border-amber-400"
              >
                Postpone &amp; Keep Working
              </button>
              <button
                type="button"
                onClick={handleSaveAndRefresh}
                disabled={isApplyingUpdate}
                className="px-4 py-1.5 bg-slate-950 hover:bg-black text-white font-bold rounded-lg text-xs transition shadow-md flex items-center gap-1.5"
              >
                {isApplyingUpdate ? (
                  <span>Saving &amp; Reloading...</span>
                ) : (
                  <>
                    <span>💾</span>
                    <span>Auto-Save &amp; Update Now</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white font-medium rounded-lg text-xs transition"
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-1.5 bg-white text-indigo-700 hover:bg-indigo-50 font-bold rounded-lg text-xs transition shadow-md"
              >
                Update Now
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
