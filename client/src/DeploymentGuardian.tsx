import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import * as API from './api';
import { getAllDrafts } from './draftStorage';

export const CLIENT_VERSION = 'v1.2.2';

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
  const [lastSavedNotice, setLastSavedNotice] = useState<string | null>(null);
  const sessionId = useRef(getSessionId()).current;

  // Check draft count
  const updateDraftCount = () => {
    const drafts = getAllDrafts();
    setDraftCount(drafts.length);
  };

  useEffect(() => {
    updateDraftCount();
    const handleDraftUpdate = () => {
      updateDraftCount();
      setLastSavedNotice(new Date().toLocaleTimeString());
      setTimeout(() => setLastSavedNotice(null), 3000);
    };

    window.addEventListener('inspectai_draft_updated', handleDraftUpdate);
    window.addEventListener('storage', handleDraftUpdate);
    return () => {
      window.removeEventListener('inspectai_draft_updated', handleDraftUpdate);
      window.removeEventListener('storage', handleDraftUpdate);
    };
  }, []);

  // Prevent accidental tab closing if unsaved changes exist
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (draftCount > 0) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [draftCount]);

  // Heartbeat loop every 20 seconds
  useEffect(() => {
    let isMounted = true;

    const runHeartbeat = async () => {
      try {
        const res = await API.sendHeartbeat({
          sessionId,
          userId: user?.id,
          userName: user?.fullName || 'User',
          userEmail: user?.email,
          currentPath: location.pathname,
          hasUnsavedChanges: draftCount > 0,
          unsavedFormsCount: draftCount,
          clientVersion: CLIENT_VERSION,
        });

        if (isMounted && res.data) {
          if (res.data.serverVersion && res.data.serverVersion !== CLIENT_VERSION) {
            setUpdateAvailable(true);
            setServerVersion(res.data.serverVersion);
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
  }, [sessionId, user, location.pathname, draftCount]);

  if (!updateAvailable || dismissed) {
    if (lastSavedNotice) {
      return (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white text-xs px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-2 border border-slate-700 animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          Draft auto-saved locally at {lastSavedNotice}
        </div>
      );
    }
    return null;
  }

  const hasUnsaved = draftCount > 0;

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-3 shadow-lg border-b text-sm transition-all ${
      hasUnsaved 
        ? 'bg-amber-500 text-amber-950 border-amber-600' 
        : 'bg-indigo-600 text-white border-indigo-700'
    }`}>
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-medium">
          <span className="text-xl">{hasUnsaved ? '🛡️' : '🚀'}</span>
          <span>
            {hasUnsaved ? (
              <>
                <strong>New Deployment Detected ({serverVersion || 'Latest'}).</strong> You have <span className="underline font-bold">{draftCount} unsaved draft(s)</span> in progress. Your work is backed up locally. Save your changes before updating.
              </>
            ) : (
              <>
                <strong>New Deployment Live ({serverVersion || 'Latest'}).</strong> A new update is ready to be applied.
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hasUnsaved ? (
            <>
              <button
                onClick={() => setDismissed(true)}
                className="px-3 py-1 bg-amber-200/80 hover:bg-amber-200 text-amber-950 font-semibold rounded-lg text-xs transition"
              >
                Postpone & Keep Working
              </button>
              <button
                onClick={() => {
                  if (confirm('Make sure your form changes are saved! Proceed to refresh?')) {
                    window.location.reload();
                  }
                }}
                className="px-3 py-1 bg-amber-950 hover:bg-black text-white font-semibold rounded-lg text-xs transition shadow-sm"
              >
                Refresh Now
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setDismissed(true)}
                className="px-3 py-1 bg-white/20 hover:bg-white/30 text-white font-medium rounded-lg text-xs transition"
              >
                Later
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-3 py-1 bg-white text-indigo-700 hover:bg-indigo-50 font-bold rounded-lg text-xs transition shadow-sm"
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
