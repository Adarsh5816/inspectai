import { useState, useEffect } from 'react';
import * as API from './api';
import { CLIENT_VERSION } from './DeploymentGuardian';

export function AdminPage({ currentUser }: { currentUser?: any }) {
  const [activeTab, setActiveTab] = useState<'releases' | 'sessions' | 'system' | 'users'>('releases');
  const [releasesData, setReleasesData] = useState<any>(null);
  const [onlineData, setOnlineData] = useState<any>(null);
  const [systemData, setSystemData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // User & Team Hierarchy state
  const [usersList, setUsersList] = useState<any[]>([]);
  const [managersList, setManagersList] = useState<any[]>([]);
  const [treeData, setTreeData] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [viewMode, setViewMode] = useState<'tree' | 'table'>('tree');
  const [showUserModal, setShowUserModal] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userForm, setUserForm] = useState({
    id: '',
    fullName: '',
    email: '',
    password: '',
    role: 'INSPECTOR',
    managerId: '',
    organization: '',
    isActive: true,
  });
  const [savingUser, setSavingUser] = useState(false);

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

  const loadUsersData = async () => {
    setLoadingUsers(true);
    try {
      const [uRes, mRes, tRes] = await Promise.all([
        API.getUsers().catch(() => ({ data: [] })),
        API.getManagers().catch(() => ({ data: [] })),
        API.getUserTree().catch(() => ({ data: [] })),
      ]);
      setUsersList(uRes.data || []);
      setManagersList(mRes.data || []);
      setTreeData(tRes.data || []);
    } catch {
      // quiet
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    loadAll();
    loadUsersData();
    const interval = setInterval(() => {
      // Auto-refresh online users & status quietly
      API.getOnlineUsers().then(r => setOnlineData(r.data)).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenAddUser = (defaultManagerId?: string) => {
    setUserForm({
      id: '',
      fullName: '',
      email: '',
      password: '',
      role: 'INSPECTOR',
      managerId: defaultManagerId || (currentUser?.role === 'MANAGER' ? currentUser.id : ''),
      organization: currentUser?.organization || 'Intertek',
      isActive: true,
    });
    setShowUserModal(true);
  };

  const handleEditUser = (user: any) => {
    setUserForm({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      password: '',
      role: user.role,
      managerId: user.managerId || '',
      organization: user.organization || '',
      isActive: user.isActive,
    });
    setShowUserModal(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.fullName || !userForm.email) return;
    if (!userForm.id && !userForm.password) {
      alert('Password is required for new users.');
      return;
    }

    setSavingUser(true);
    try {
      if (userForm.id) {
        await API.updateUser(userForm.id, userForm);
        alert('User details updated successfully!');
      } else {
        await API.createUser(userForm);
        alert('New user / field staff account created successfully!');
      }
      setShowUserModal(false);
      loadUsersData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save user');
    } finally {
      setSavingUser(false);
    }
  };

  const handleToggleUserActive = async (user: any) => {
    const nextStatus = !user.isActive;
    if (!confirm(`Are you sure you want to ${nextStatus ? 'activate' : 'deactivate'} user "${user.fullName}"?`)) return;
    try {
      await API.updateUser(user.id, { isActive: nextStatus });
      loadUsersData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update user status');
    }
  };

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
        <button
          onClick={() => { setActiveTab('users'); loadUsersData(); }}
          className={`pb-3 px-4 font-semibold text-sm border-b-2 transition flex items-center gap-2 ${
            activeTab === 'users'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <span>🌳</span> Team &amp; Access Hierarchy ({usersList.length})
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
      {/* TAB 4: Team & Access Hierarchy */}
      {activeTab === 'users' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <div>
              <h3 className="font-bold text-base text-slate-800 flex items-center gap-2">
                <span>🌳</span> Team Members &amp; Access Tree
              </h3>
              <p className="text-xs text-slate-500">
                Managers can create and oversee Field Staff reporting to them. Field Staff only see their own assigned projects and inspections.
              </p>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setViewMode('tree')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${viewMode === 'tree' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  🌳 Org Tree View
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${viewMode === 'table' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  📋 Table View
                </button>
              </div>

              <button
                onClick={() => handleOpenAddUser()}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm whitespace-nowrap ml-auto"
              >
                + Add Staff / Member
              </button>
            </div>
          </div>

          {/* Quick Filter */}
          <div className="flex items-center justify-between gap-4">
            <input
              type="text"
              placeholder="Search team members by name, email, or role..."
              value={userSearchQuery}
              onChange={e => setUserSearchQuery(e.target.value)}
              className="max-w-md w-full px-3.5 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-500 font-medium">
              {usersList.length} total team members registered
            </span>
          </div>

          {loadingUsers ? (
            <div className="p-12 text-center text-slate-400">Loading team members and hierarchy...</div>
          ) : viewMode === 'tree' ? (
            /* Interactive Tree View */
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-3 text-xs text-slate-500 pb-2 border-b border-slate-100">
                <span className="flex items-center gap-1 font-semibold text-purple-700">👑 Admin (Full Company Access)</span>
                <span>•</span>
                <span className="flex items-center gap-1 font-semibold text-blue-700">👔 Manager (Team &amp; Subordinate Access)</span>
                <span>•</span>
                <span className="flex items-center gap-1 font-semibold text-emerald-700">👷 Field Staff (Self Only)</span>
              </div>

              {treeData.length === 0 ? (
                <p className="text-center py-8 text-slate-500 text-sm">No user hierarchy found.</p>
              ) : (
                <div className="space-y-4">
                  {treeData
                    .filter((node: any) => {
                      if (!userSearchQuery) return true;
                      const q = userSearchQuery.toLowerCase();
                      return (
                        node.fullName.toLowerCase().includes(q) ||
                        node.email.toLowerCase().includes(q) ||
                        node.role.toLowerCase().includes(q)
                      );
                    })
                    .map((node: any) => (
                      <OrgTreeNode
                        key={node.id}
                        node={node}
                        currentUser={currentUser}
                        onAddUnder={(managerId: string) => handleOpenAddUser(managerId)}
                        onEdit={(u: any) => handleEditUser(u)}
                        onToggleActive={(u: any) => handleToggleUserActive(u)}
                      />
                    ))}
                </div>
              )}
            </div>
          ) : (
            /* Table View */
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="p-3 text-left font-bold text-slate-700">Name &amp; Email</th>
                    <th className="p-3 text-left font-bold text-slate-700">Role</th>
                    <th className="p-3 text-left font-bold text-slate-700">Reports To (Manager)</th>
                    <th className="p-3 text-center font-bold text-slate-700">Inspections</th>
                    <th className="p-3 text-center font-bold text-slate-700">Projects</th>
                    <th className="p-3 text-center font-bold text-slate-700">Status</th>
                    <th className="p-3 text-right font-bold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {usersList
                    .filter((u: any) => {
                      if (!userSearchQuery) return true;
                      const q = userSearchQuery.toLowerCase();
                      return (
                        u.fullName.toLowerCase().includes(q) ||
                        u.email.toLowerCase().includes(q) ||
                        u.role.toLowerCase().includes(q)
                      );
                    })
                    .map((u: any) => {
                      return (
                        <tr key={u.id} className="hover:bg-slate-50 transition">
                          <td className="p-3">
                            <span className="font-bold text-slate-800 block">{u.fullName}</span>
                            <span className="text-slate-500 font-mono text-[11px]">{u.email}</span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              u.role === 'ADMIN' ? 'bg-purple-100 text-purple-800' :
                              u.role === 'MANAGER' ? 'bg-blue-100 text-blue-800' :
                              'bg-emerald-100 text-emerald-800'
                            }`}>
                              {u.role === 'ADMIN' ? '👑 Admin' : u.role === 'MANAGER' ? '👔 Manager' : '👷 Field Staff'}
                            </span>
                          </td>
                          <td className="p-3">
                            {u.manager ? (
                              <span className="font-medium text-slate-700">{u.manager.fullName}</span>
                            ) : (
                              <span className="text-slate-400 italic">None (Top Level)</span>
                            )}
                          </td>
                          <td className="p-3 text-center font-bold text-slate-700">
                            {u._count?.assignedInspections || 0}
                          </td>
                          <td className="p-3 text-center font-bold text-slate-700">
                            {u._count?.assignedProjects || 0}
                          </td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${u.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                              {u.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {(currentUser?.role === 'ADMIN' || (currentUser?.role === 'MANAGER' && u.role === 'INSPECTOR')) && (
                                <button
                                  onClick={() => handleEditUser(u)}
                                  className="text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 rounded hover:bg-blue-50"
                                >
                                  Edit
                                </button>
                              )}
                              {currentUser?.id !== u.id && (
                                <button
                                  onClick={() => handleToggleUserActive(u)}
                                  className={`text-[11px] font-semibold px-2 py-1 rounded ${u.isActive ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}
                                >
                                  {u.isActive ? 'Deactivate' : 'Activate'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>👤</span> {userForm.id ? 'Edit User Details' : 'Create New User / Field Staff'}
              </h3>
              <button onClick={() => setShowUserModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={userForm.fullName}
                  onChange={e => setUserForm({ ...userForm, fullName: e.target.value })}
                  placeholder="e.g. Ramesh Kumar"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  value={userForm.email}
                  onChange={e => setUserForm({ ...userForm, email: e.target.value })}
                  placeholder="e.g. ramesh.kumar@inspectai.com"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  {userForm.id ? 'Password (Leave blank to keep existing)' : 'Password *'}
                </label>
                <input
                  type="password"
                  required={!userForm.id}
                  value={userForm.password}
                  onChange={e => setUserForm({ ...userForm, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Role</label>
                  {currentUser?.role === 'MANAGER' ? (
                    <input
                      type="text"
                      disabled
                      value="Field Staff (Inspector)"
                      className="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-lg text-sm text-slate-600 font-semibold"
                    />
                  ) : (
                    <select
                      value={userForm.role}
                      onChange={e => setUserForm({ ...userForm, role: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                      <option value="INSPECTOR">👷 Field Staff (Inspector)</option>
                      <option value="MANAGER">👔 Team Manager / Lead</option>
                      <option value="ADMIN">👑 Company Admin</option>
                    </select>
                  )}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Reporting Manager</label>
                  {currentUser?.role === 'MANAGER' ? (
                    <input
                      type="text"
                      disabled
                      value={`${currentUser.fullName || 'Manager'} (You)`}
                      className="w-full px-3 py-2 bg-slate-100 border border-slate-300 rounded-lg text-sm text-slate-600 font-semibold"
                    />
                  ) : (
                    <select
                      value={userForm.managerId}
                      onChange={e => setUserForm({ ...userForm, managerId: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    >
                      <option value="">None (Top-Level / Admin)</option>
                      {managersList.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.fullName} ({m.role === 'ADMIN' ? 'Admin' : 'Manager'})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Organization / Agency</label>
                <input
                  type="text"
                  value={userForm.organization}
                  onChange={e => setUserForm({ ...userForm, organization: e.target.value })}
                  placeholder="e.g. Intertek / TUV SUD"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-sm"
                >
                  {savingUser ? 'Saving...' : userForm.id ? 'Save Changes' : 'Create User Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function OrgTreeNode({ node, currentUser, onAddUnder, onEdit, onToggleActive }: any) {
  const isManagerOrAdmin = node.role === 'ADMIN' || node.role === 'MANAGER';
  const roleColor = node.role === 'ADMIN'
    ? 'border-purple-200 bg-purple-50/40 text-purple-900'
    : node.role === 'MANAGER'
    ? 'border-blue-200 bg-blue-50/40 text-blue-900'
    : 'border-emerald-200 bg-emerald-50/40 text-emerald-900';

  const roleBadge = node.role === 'ADMIN'
    ? 'bg-purple-100 text-purple-800 border-purple-200'
    : node.role === 'MANAGER'
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : 'bg-emerald-100 text-emerald-800 border-emerald-200';

  return (
    <div className="space-y-2">
      <div className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs ${roleColor}`}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white border flex items-center justify-center text-base shadow-xs">
            {node.role === 'ADMIN' ? '👑' : node.role === 'MANAGER' ? '👔' : '👷'}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-800">{node.fullName}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${roleBadge}`}>
                {node.role === 'ADMIN' ? 'Admin' : node.role === 'MANAGER' ? 'Manager' : 'Field Staff'}
              </span>
              {!node.isActive && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">
                  Inactive
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{node.email}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2 text-[11px] text-slate-600 bg-white/80 px-2.5 py-1 rounded-lg border border-slate-200">
            <span><strong>{node.inspectionsCount || 0}</strong> Inspections</span>
            <span>•</span>
            <span><strong>{node.projectsCount || 0}</strong> Projects</span>
            {isManagerOrAdmin && (
              <>
                <span>•</span>
                <span><strong>{node.subordinates?.length || 0}</strong> Staff</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {isManagerOrAdmin && (currentUser?.role === 'ADMIN' || currentUser?.id === node.id) && (
              <button
                type="button"
                onClick={() => onAddUnder(node.id)}
                className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs transition"
                title={`Add new field staff reporting to ${node.fullName}`}
              >
                + Add Staff
              </button>
            )}
            {(currentUser?.role === 'ADMIN' || (currentUser?.role === 'MANAGER' && node.role === 'INSPECTOR')) && (
              <button
                type="button"
                onClick={() => onEdit(node)}
                className="px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-blue-700 rounded-lg text-xs font-semibold shadow-2xs transition"
              >
                Edit
              </button>
            )}
            {currentUser?.id !== node.id && (
              <button
                type="button"
                onClick={() => onToggleActive(node)}
                className={`px-2 py-1 rounded-lg text-xs font-semibold transition ${node.isActive ? 'text-red-600 hover:bg-red-50' : 'text-green-700 hover:bg-green-50'}`}
              >
                {node.isActive ? 'Deactivate' : 'Activate'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Subordinates tree branches */}
      {node.subordinates && node.subordinates.length > 0 && (
        <div className="ml-6 pl-4 border-l-2 border-indigo-200 space-y-2 pt-1">
          {node.subordinates.map((subNode: any) => (
            <OrgTreeNode
              key={subNode.id}
              node={subNode}
              currentUser={currentUser}
              onAddUnder={onAddUnder}
              onEdit={onEdit}
              onToggleActive={onToggleActive}
            />
          ))}
        </div>
      )}
    </div>
  );
}
