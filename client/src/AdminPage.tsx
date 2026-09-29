import { useState, useEffect } from 'react';
import * as API from './api';
import { CLIENT_VERSION } from './DeploymentGuardian';

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<'releases' | 'sessions' | 'system'>('releases');
  const [releasesData, setReleasesData] = useState<any>(null);
  const [onlineData, setOnlineData] = useState<any>(null);
  const [systemData, setSystemData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Add Note Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newVersion, setNewVersion] = useState('v1.2.3');
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('Bug Fix');
  const [newSummary, setNewSummary] = useState('');
  const [newChangesText, setNewChangesText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const loadAll = async () => {
    try {
      const [rel, onl, sys] = await Promise.all([
        API.getReleases().catch(() => ({ data: null })),
        API.getOnlineUsers().catch(() => ({ data: null })),
        API.getSystemStatus().catch(() => ({ data: null })),
      ]);
      setReleasesData(rel.data);
      setOnlineData(onl.data);
      setSystemData(sys.data);
    } catch {
      // quiet
    }
  };

  useEffect(() => {
    loadAll();
    const interval = setInterval(() => {
      // Auto-refresh online users & status quietly
      API.getOnlineUsers().then(r => setOnlineData(r.data)).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleAddReleaseNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVersion || !newTitle || !newSummary) return;

    setSavingNote(true);
    try {
      const parsedChanges = newChangesText
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => {
          let category: 'Fix' | 'Feature' | 'Improvement' | 'Security' | 'Infra' = 'Improvement';
          let desc = line;
          if (line.toLowerCase().startsWith('[fix]')) {
            category = 'Fix';
            desc = line.replace(/^\[fix\]\s*/i, '');
          } else if (line.toLowerCase().startsWith('[feat]') || line.toLowerCase().startsWith('[feature]')) {
            category = 'Feature';
            desc = line.replace(/^\[(feat|feature)\]\s*/i, '');
          } else if (line.toLowerCase().startsWith('[sec]') || line.toLowerCase().startsWith('[security]')) {
            category = 'Security';
            desc = line.replace(/^\[(sec|security)\]\s*/i, '');
          } else if (line.toLowerCase().startsWith('[infra]')) {
            category = 'Infra';
            desc = line.replace(/^\[infra\]\s*/i, '');
          }
          return { category, description: desc };
        });

      await API.addReleaseNote({
        version: newVersion,
        title: newTitle,
        type: newType,
        summary: newSummary,
        changes: parsedChanges.length > 0 ? parsedChanges : [{ category: 'Improvement', description: newSummary }]
      });

      setShowAddModal(false);
      setNewTitle('');
      setNewSummary('');
      setNewChangesText('');
      loadAll();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save patch note');
    } finally {
      setSavingNote(false);
    }
  };

  const releases = releasesData?.releases || [];
  const filteredReleases = releases.filter((r: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.version.toLowerCase().includes(q) ||
      r.title.toLowerCase().includes(q) ||
      r.summary.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q)
    );
  });

  const usersWithUnsaved = onlineData?.usersWithUnsavedChanges || 0;
  const isSafeToDeploy = usersWithUnsaved === 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-800">Admin & Release Management</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
              {CLIENT_VERSION} Live
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Always track deployment patch notes, verify live system changes, and monitor online user data safety.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadAll}
            className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-700 transition flex items-center gap-1.5"
          >
            🔄 Refresh
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition shadow-sm flex items-center gap-1.5"
          >
            + Add Patch Note
          </button>
        </div>
      </div>

      {/* Deployment Readiness Banner */}
      <div className={`p-4 rounded-xl border flex items-center justify-between gap-4 transition-all ${
        isSafeToDeploy
          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
          : 'bg-amber-50 border-amber-300 text-amber-950'
      }`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{isSafeToDeploy ? '✅' : '⚠️'}</span>
          <div>
            <h3 className="font-bold text-sm">
              {isSafeToDeploy ? 'Safe for Next Deployment' : 'Active Editing in Progress — Delay Deployment'}
            </h3>
            <p className="text-xs opacity-90 mt-0.5">
              {isSafeToDeploy
                ? 'All online users are idle or have saved their work. No unsaved data will be lost.'
                : `${usersWithUnsaved} active session(s) currently have unsaved form drafts. The Deployment Guardian will protect their work.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/70 border border-current shadow-xs">
            {onlineData?.totalOnline || 0} Online Session(s)
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab('releases')}
          className={`pb-3 px-4 font-semibold text-sm border-b-2 transition flex items-center gap-2 ${
            activeTab === 'releases'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>📜</span> Release Notes & Patch History ({releases.length})
        </button>
        <button
          onClick={() => setActiveTab('sessions')}
          className={`pb-3 px-4 font-semibold text-sm border-b-2 transition flex items-center gap-2 ${
            activeTab === 'sessions'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>👥</span> Online Users & Data Safety ({onlineData?.totalOnline || 0})
        </button>
        <button
          onClick={() => setActiveTab('system')}
          className={`pb-3 px-4 font-semibold text-sm border-b-2 transition flex items-center gap-2 ${
            activeTab === 'system'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>⚙️</span> System Health & Database
        </button>
      </div>

      {/* TAB 1: Release Notes & Patch Notes */}
      {activeTab === 'releases' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <input
              type="text"
              placeholder="Search release notes, features, fixes..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="max-w-md w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="text-xs text-slate-500 font-medium">
              Showing {filteredReleases.length} of {releases.length} tracked deployments
            </span>
          </div>

          <div className="space-y-4">
            {filteredReleases.map((rel: any) => {
              const isCurrent = rel.isCurrent || rel.version === (releasesData?.currentVersion || CLIENT_VERSION);
              const dateStr = new Date(rel.releaseDate).toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });

              return (
                <div
                  key={rel.id || rel.version}
                  className={`bg-white rounded-2xl p-6 border transition-shadow shadow-sm ${
                    isCurrent ? 'border-blue-300 ring-2 ring-blue-100' : 'border-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-slate-900">{rel.version}</span>
                      <span className="font-semibold text-slate-700">— {rel.title}</span>
                      {isCurrent && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          CURRENT DEPLOYMENT
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md font-medium">
                        {rel.type}
                      </span>
                      {rel.environment && (
                        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-md font-medium">
                          {rel.environment}
                        </span>
                      )}
                      <span className="text-slate-400 font-medium">🕒 {dateStr}</span>
                    </div>
                  </div>

                  <p className="text-sm text-slate-600 mb-4">{rel.summary}</p>

                  {rel.changes && rel.changes.length > 0 && (
                    <div className="bg-slate-50/70 rounded-xl p-3 border border-slate-100">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                        Changes in this build:
                      </h4>
                      <ul className="space-y-1.5 text-xs text-slate-700">
                        {rel.changes.map((c: any, idx: number) => {
                          let badgeColor = 'bg-slate-100 text-slate-700';
                          if (c.category === 'Fix') badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                          if (c.category === 'Feature') badgeColor = 'bg-blue-100 text-blue-800 border-blue-200';
                          if (c.category === 'Security') badgeColor = 'bg-purple-100 text-purple-800 border-purple-200';
                          if (c.category === 'Infra') badgeColor = 'bg-amber-100 text-amber-800 border-amber-200';

                          return (
                            <li key={idx} className="flex items-start gap-2">
                              <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${badgeColor}`}>
                                {c.category}
                              </span>
                              <span>{c.description}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredReleases.length === 0 && (
              <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 text-slate-500">
                No release notes match your query.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Online Sessions & Data Safety Monitor */}
      {activeTab === 'sessions' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
            <h3 className="text-base font-bold text-slate-800 mb-1">
              Real-Time Online Presence & Unsaved Draft Monitor
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Before deploying, inspect whether any inspector or engineer has unsaved data in their active workspace.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="p-3">User</th>
                    <th className="p-3">Active Page / Workspace</th>
                    <th className="p-3">Unsaved Work Status</th>
                    <th className="p-3">Client Build</th>
                    <th className="p-3">Last Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {onlineData?.sessions && onlineData.sessions.length > 0 ? (
                    onlineData.sessions.map((sess: any) => {
                      const secondsAgo = Math.max(0, Math.floor((Date.now() - new Date(sess.lastActive).getTime()) / 1000));
                      return (
                        <tr key={sess.sessionId} className="hover:bg-slate-50/50">
                          <td className="p-3 font-semibold text-slate-800">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                              <span>{sess.userName}</span>
                              {sess.userEmail && (
                                <span className="text-slate-400 font-normal">({sess.userEmail})</span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-slate-600 font-mono text-[11px]">
                            {sess.currentPath}
                          </td>
                          <td className="p-3">
                            {sess.hasUnsavedChanges ? (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                🟡 {sess.unsavedFormsCount || 1} Unsaved Draft(s)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                🟢 All Data Saved
                              </span>
                            )}
                          </td>
                          <td className="p-3 font-mono text-slate-600">
                            {sess.clientVersion}
                          </td>
                          <td className="p-3 text-slate-500">
                            {secondsAgo}s ago
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-400">
                        No other active sessions detected in the last 45 seconds.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: System Health & Database Diagnostics */}
      {activeTab === 'system' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-semibold uppercase">Projects</span>
              <p className="text-2xl font-bold text-slate-800 mt-1">{systemData?.counts?.projects || 0}</p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-semibold uppercase">Inspections</span>
              <p className="text-2xl font-bold text-emerald-600 mt-1">{systemData?.counts?.inspections || 0}</p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-semibold uppercase">Documents</span>
              <p className="text-2xl font-bold text-blue-600 mt-1">{systemData?.counts?.documents || 0}</p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <span className="text-xs text-slate-500 font-semibold uppercase">Photos</span>
              <p className="text-2xl font-bold text-purple-600 mt-1">{systemData?.counts?.photos || 0}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-800">Environment & Server Metrics</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                <span className="text-slate-500 font-medium">Deployment Target:</span>
                <p className="font-bold text-slate-800">{systemData?.system?.environment || 'Render Cloud'}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                <span className="text-slate-500 font-medium">Database:</span>
                <p className="font-bold text-slate-800">{systemData?.database || 'SQLite (Prisma ORM)'}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                <span className="text-slate-500 font-medium">Node Version:</span>
                <p className="font-bold text-slate-800">{systemData?.system?.nodeVersion || 'v20.x'}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                <span className="text-slate-500 font-medium">Server Uptime:</span>
                <p className="font-bold text-slate-800">{Math.floor((systemData?.system?.uptimeSeconds || 0) / 60)} minutes</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Patch Note Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>📝</span> Record New Deployment / Patch Note
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <form onSubmit={handleAddReleaseNote} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Version</label>
                  <input
                    type="text"
                    required
                    value={newVersion}
                    onChange={e => setNewVersion(e.target.value)}
                    placeholder="v1.2.3"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Release Type</label>
                  <select
                    value={newType}
                    onChange={e => setNewType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="Bug Fix">Bug Fix / Hotfix</option>
                    <option value="Feature">Feature Release</option>
                    <option value="Security & Stability">Security & Stability</option>
                    <option value="Infrastructure">Infrastructure</option>
                    <option value="Major Release">Major Release</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="e.g. Foreign Key Fix & Real-time Auto-save"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Summary / Highlights</label>
                <textarea
                  required
                  rows={2}
                  value={newSummary}
                  onChange={e => setNewSummary(e.target.value)}
                  placeholder="Overview of what was deployed..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Change Items (One per line. Prefix with [Fix], [Feature], [Security], or [Infra])
                </label>
                <textarea
                  rows={4}
                  value={newChangesText}
                  onChange={e => setNewChangesText(e.target.value)}
                  placeholder="[Fix] Resolved project creation foreign key error&#10;[Feature] Added CSV and Word format support for RFIs&#10;[Security] Auto-healed client auth tokens"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingNote}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-sm"
                >
                  {savingNote ? 'Saving...' : 'Save & Publish Patch Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
