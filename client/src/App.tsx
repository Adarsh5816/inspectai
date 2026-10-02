import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import * as API from './api';
import { DeploymentGuardian } from './DeploymentGuardian';
import { AdminPage } from './AdminPage';
import { saveDraft, loadDraft, clearDraft } from './draftStorage';
import AutocompleteInput from './AutocompleteInput';

// ============================================================
// Auth Context
// ============================================================
function useAuth() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      API.getMe()
        .then(r => {
          setUser(r.data.user);
          if (r.data.user?.id) {
            localStorage.setItem('token', `token-${r.data.user.id}`);
          }
        })
        .catch(() => localStorage.removeItem('token'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const r = await API.login(email, password);
    localStorage.setItem('token', r.data.token);
    setUser(r.data.user);
  };

  const logout = () => { localStorage.removeItem('token'); setUser(null); };
  return { user, loading, login, logout };
}

// ============================================================
// Login Page
// ============================================================
function LoginPage({ onLogin }: { onLogin: (e: string, p: string) => Promise<void> }) {
  const [email, setEmail] = useState('admin@inspectai.com');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try { await onLogin(email, password); } catch { setError('Invalid credentials'); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-800">INSPECT<span className="text-blue-600">AI</span></h1>
          <p className="text-slate-500 mt-1">AI-Powered Inspection Report Automation</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================
// Layout
// ============================================================
function Layout({ user, onLogout, children }: { user: any; onLogout: () => void; children: React.ReactNode }) {
  const location = useLocation();
  const navItems = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/projects', label: 'Projects', icon: '📁' },
    { path: '/inspections', label: 'Inspections', icon: '🔍' },
    { path: '/documents', label: 'Documents', icon: '📄' },
    { path: '/photos', label: 'Photos', icon: '📸' },
    ...(user?.role === 'ADMIN' || user?.role === 'MANAGER'
      ? [{ path: '/admin', label: user.role === 'ADMIN' ? 'Admin & Team' : 'Team Management', icon: '👥' }]
      : []),
  ];

  const roleBadge = user?.role === 'ADMIN'
    ? 'bg-purple-100 text-purple-800 border-purple-200'
    : user?.role === 'MANAGER'
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : 'bg-emerald-100 text-emerald-800 border-emerald-200';

  const roleLabel = user?.role === 'ADMIN'
    ? '👑 Admin'
    : user?.role === 'MANAGER'
    ? '👔 Manager'
    : '👷 Field Staff';

  return (
    <div className="min-h-screen bg-slate-50">
      <DeploymentGuardian user={user} />
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-xl font-bold text-slate-800">INSPECT<span className="text-blue-600">AI</span></Link>
          <div className="flex gap-1">
            {navItems.map(item => (
              <Link key={item.path} to={item.path}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path)) ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                {item.icon} {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${roleBadge}`}>
              {roleLabel}
            </span>
            <span className="text-sm font-semibold text-slate-700">{user?.fullName}</span>
          </div>
          <button onClick={onLogout} className="text-xs font-semibold px-2.5 py-1 text-red-600 hover:bg-red-50 rounded-lg transition">Logout</button>
        </div>
      </nav>
      <main className="p-6 max-w-7xl mx-auto">{children}</main>
    </div>
  );
}

// ============================================================
// Dashboard Page
// ============================================================
function DashboardPage() {
  const [stats, setStats] = useState({ projects: 0, inspections: 0, documents: 0 });
  const [inspections, setInspections] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([API.getProjects(), API.getInspections()]).then(([p, i]) => {
      setStats({ projects: p.data.length, inspections: i.data.length, documents: 0 });
      setInspections(i.data.slice(0, 5));
    }).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard title="Projects" value={stats.projects} icon="📁" color="blue" />
        <StatCard title="Inspections" value={stats.inspections} icon="🔍" color="green" />
        <StatCard title="Today" value={new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} icon="📅" color="purple" />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Recent Inspections</h2>
        {inspections.length === 0 ? (
          <p className="text-slate-500">No inspections yet. <Link to="/inspections/new" className="text-blue-600 hover:underline">Create one</Link></p>
        ) : (
          <div className="space-y-3">
            {inspections.map((insp: any) => (
              <Link key={insp.id} to={`/inspections/${insp.id}`} className="block p-4 border border-slate-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-medium text-slate-800">{insp.reportNumber}</span>
                    <span className="ml-3 text-sm text-slate-500">{insp.inspectionType}</span>
                  </div>
                  <StatusBadge status={insp.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, color }: { title: string; value: any; icon: string; color: string }) {
  const colors: Record<string, string> = { blue: 'bg-blue-50 border-blue-200', green: 'bg-green-50 border-green-200', purple: 'bg-purple-50 border-purple-200' };
  return (
    <div className={`p-6 rounded-xl border ${colors[color]}`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div><p className="text-sm text-slate-500">{title}</p><p className="text-2xl font-bold text-slate-800">{value}</p></div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT: 'bg-yellow-100 text-yellow-800', IN_PROGRESS: 'bg-blue-100 text-blue-800',
    ACCEPTABLE: 'bg-green-100 text-green-800', COMPLETED: 'bg-green-100 text-green-800',
    PENDING: 'bg-gray-100 text-gray-800', NOT_ACCEPTABLE: 'bg-red-100 text-red-800',
    ON_HOLD: 'bg-orange-100 text-orange-800', APPROVED: 'bg-emerald-100 text-emerald-800',
  };
  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>{status}</span>;
}

// ============================================================
// Projects Page
// ============================================================
function ProjectsPage({ currentUser }: { currentUser?: any }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(() => {
    const draft = loadDraft<any>('new_project');
    return !!(draft?.data?.projectNumber || draft?.data?.projectName);
  });
  const [form, setForm] = useState(() => {
    const draft = loadDraft<any>('new_project');
    return draft?.data || { projectNumber: '', projectName: '', customerName: '', supplierName: '', supplierAddress: '', poNumber: '' };
  });

  const load = () => API.getProjects().then(r => setProjects(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  // Auto-save draft on change
  useEffect(() => {
    if (form.projectNumber || form.projectName || form.customerName || form.supplierName || form.supplierAddress || form.poNumber) {
      saveDraft('new_project', form);
    }
  }, [form]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await API.createProject(form);
      clearDraft('new_project');
      setShowForm(false);
      setForm({ projectNumber: '', projectName: '', customerName: '', supplierName: '', supplierAddress: '', poNumber: '' });
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || err.message || 'Failed to create project');
    }
  };

  const handleDelete = async (e: React.MouseEvent, projectId: string, projectNumber: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete project ${projectNumber}? All associated inspections and documents will also be deleted.`)) return;
    try {
      await API.deleteProject(projectId);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete project');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Projects</h1>
          <p className="text-sm text-slate-500 mt-1">
            {currentUser?.role === 'ADMIN' && 'Showing company-wide projects.'}
            {currentUser?.role === 'MANAGER' && 'Showing projects assigned to your team.'}
            {currentUser?.role === 'INSPECTOR' && 'Showing projects assigned to you.'}
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium">+ New Project</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-6 mb-6 space-y-4">
          {loadDraft('new_project') && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-1.5 rounded-lg flex items-center justify-between">
              <span>🛡️ Restored unsaved project draft from your previous session.</span>
              <button
                type="button"
                onClick={() => {
                  clearDraft('new_project');
                  setForm({ projectNumber: '', projectName: '', customerName: '', supplierName: '', supplierAddress: '', poNumber: '' });
                  setShowForm(false);
                }}
                className="text-amber-900 underline font-semibold ml-2"
              >
                Discard Draft
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Project Number" value={form.projectNumber} onChange={v => setForm({ ...form, projectNumber: v })} placeholder="P30339B" required />
            <Input label="Project Name" value={form.projectName} onChange={v => setForm({ ...form, projectName: v })} placeholder="EPC for SE AiP5 Project..." required />
            <AutocompleteInput label="Customer" category="customer" value={form.customerName} onChange={v => setForm({ ...form, customerName: v })} placeholder="ADNOC Onshore" required />
            <AutocompleteInput label="Supplier" category="supplier" value={form.supplierName} onChange={v => setForm({ ...form, supplierName: v })} placeholder="KSB MIL Controls Limited" required />
            <Input label="PO Number" value={form.poNumber} onChange={v => setForm({ ...form, poNumber: v })} placeholder="04108-PM-INST-008" required />
            <AutocompleteInput label="Supplier Location" category="location" value={form.supplierAddress || ''} onChange={v => setForm({ ...form, supplierAddress: v })} placeholder="Meladoor, Kerala" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium">Create Project</button>
            <button
              type="button"
              onClick={() => {
                clearDraft('new_project');
                setForm({ projectNumber: '', projectName: '', customerName: '', supplierName: '', supplierAddress: '', poNumber: '' });
                setShowForm(false);
              }}
              className="text-slate-600 px-4 py-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="grid gap-4">
        {projects.map((p: any) => (
          <div key={p.id} className="relative group bg-white rounded-xl border border-slate-200 p-6 hover:border-blue-300 transition-colors">
            <div className="flex justify-between items-start">
              <Link to={`/projects/${p.id}`} className="flex-1 block">
                <h3 className="text-lg font-semibold text-slate-800 hover:text-blue-600">{p.projectNumber} — {p.projectName}</h3>
                <div className="mt-2 text-sm text-slate-500 grid grid-cols-3 gap-2">
                  <span>Customer: {p.customerName}</span>
                  <span>Supplier: {p.supplierName}</span>
                  <span>PO: {p.poNumber}</span>
                </div>
              </Link>
              <button
                onClick={(e) => handleDelete(e, p.id, p.projectNumber)}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition ml-3"
                title="Delete Project"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
        {projects.length === 0 && <p className="text-slate-500 text-center py-12">No projects yet.</p>}
      </div>
    </div>
  );
}

// ============================================================
// Project Detail Page
// ============================================================
function ProjectDetailPage({ currentUser }: { currentUser?: any }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  // Member assignment state
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [selectedUserIdToAssign, setSelectedUserIdToAssign] = useState('');
  const [assigningMember, setAssigningMember] = useState(false);

  // Edit Project Details state
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [editProjectForm, setEditProjectForm] = useState({
    projectName: '',
    customerName: '',
    supplierName: '',
    supplierAddress: '',
    poNumber: '',
  });
  const [savingProject, setSavingProject] = useState(false);

  const handleSaveProject = async () => {
    if (!id) return;
    setSavingProject(true);
    try {
      await API.updateProject(id, editProjectForm);
      setShowEditProjectModal(false);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update project details');
    } finally {
      setSavingProject(false);
    }
  };

  const load = useCallback(() => {
    if (!id) return;
    API.getProject(id).then(r => setProject(r.data));
    API.getDocuments(id).then(r => setDocuments(r.data)).catch(() => {});
    API.getInspections(id).then(r => setInspections(r.data)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER') {
      API.getUsers().then(r => setAvailableUsers(r.data || [])).catch(() => {});
    }
  }, [currentUser]);

  const handleAssignMember = async () => {
    if (!selectedUserIdToAssign || !id) return;
    setAssigningMember(true);
    try {
      await API.addProjectMember(id, selectedUserIdToAssign);
      setSelectedUserIdToAssign('');
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to assign team member');
    } finally {
      setAssigningMember(false);
    }
  };

  const handleRemoveMember = async (userId: string, userName: string) => {
    if (!id) return;
    if (!confirm(`Remove "${userName}" from this project?`)) return;
    try {
      await API.removeProjectMember(id, userId);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to remove member');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, documentType?: string) => {
    if (!e.target.files?.[0] || !id) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', e.target.files[0]);
    fd.append('projectId', id);
    if (documentType) {
      fd.append('documentType', documentType);
    }
    try {
      await API.uploadDocument(fd);
      load();
    } catch (err) { alert('Upload failed'); }
    setUploading(false);
    e.target.value = '';
  };

  const handleProcess = async (docId: string) => {
    setProcessing(docId);
    try {
      const r = await API.processDocument(docId);
      alert(`Document processed! Type: ${r.data.extraction?.documentType || 'Unknown'}`);
      load();
    } catch { alert('Processing failed'); }
    setProcessing(null);
  };

  const handleDeleteProject = async () => {
    if (!project) return;
    if (!confirm(`Are you sure you want to delete project ${project.projectNumber}? All associated inspections and documents will also be deleted.`)) return;
    try {
      await API.deleteProject(project.id);
      navigate('/projects');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete project');
    }
  };

  const handleDeleteDocument = async (docId: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;
    try {
      await API.deleteDocument(docId);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete document');
    }
  };

  const handleDeleteInspection = async (inspId: string, reportNo: string) => {
    if (!confirm(`Are you sure you want to delete inspection ${reportNo}? All items, results, photos, and report data will be deleted.`)) return;
    try {
      await API.deleteInspection(inspId);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete inspection');
    }
  };

  if (!project) return <div className="text-center py-12 text-slate-500">Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/projects')} className="text-slate-400 hover:text-slate-600">← Back</button>
          <h1 className="text-2xl font-bold text-slate-800">{project.projectNumber}</h1>
        </div>
        <button
          onClick={handleDeleteProject}
          className="px-3.5 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
        >
          🗑️ Delete Project
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold text-slate-800">Project Details</h2>
          <button
            type="button"
            onClick={() => {
              setEditProjectForm({
                projectName: project.projectName || '',
                customerName: project.customerName || '',
                supplierName: project.supplierName || '',
                supplierAddress: project.supplierAddress || '',
                poNumber: project.poNumber || '',
              });
              setShowEditProjectModal(true);
            }}
            className="text-xs px-2.5 py-1 border border-slate-200 text-slate-700 hover:text-blue-600 hover:bg-slate-50 rounded-md font-medium transition flex items-center gap-1 shadow-2xs"
            title="Edit Customer, Supplier, Location, and Project info"
          >
            ✏️ Edit Details
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-slate-500">Name:</span> <span className="font-medium">{project.projectName}</span></div>
          <div><span className="text-slate-500">Customer:</span> <span className="font-medium">{project.customerName}</span></div>
          <div><span className="text-slate-500">Supplier:</span> <span className="font-medium">{project.supplierName}</span></div>
          <div><span className="text-slate-500">PO:</span> <span className="font-medium">{project.poNumber}</span></div>
          {project.supplierAddress && (
            <div className="col-span-2 md:col-span-4 mt-2 pt-2 border-t border-slate-100">
              <span className="text-slate-500">Supplier Location:</span> <span className="font-medium">{project.supplierAddress}</span>
            </div>
          )}
        </div>
      </div>

      {/* Assigned Team & Field Staff Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <span>👥</span> Assigned Field Staff &amp; Team Members
            </h2>
            <p className="text-xs text-slate-500">
              Only assigned inspectors and team managers can access and conduct inspections on this project.
            </p>
          </div>

          {(currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER') && (
            <div className="flex items-center gap-2">
              <select
                value={selectedUserIdToAssign}
                onChange={e => setSelectedUserIdToAssign(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select staff member to assign...</option>
                {availableUsers
                  .filter((u: any) => !project.assignedMembers?.some((m: any) => m.userId === u.id))
                  .map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.role === 'ADMIN' ? 'Admin' : u.role === 'MANAGER' ? 'Manager' : 'Field Staff'})
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={handleAssignMember}
                disabled={assigningMember || !selectedUserIdToAssign}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50 whitespace-nowrap shadow-xs"
              >
                {assigningMember ? 'Assigning...' : '+ Assign to Project'}
              </button>
            </div>
          )}
        </div>

        {(!project.assignedMembers || project.assignedMembers.length === 0) ? (
          <p className="text-slate-500 text-xs py-2">No team members explicitly assigned yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {project.assignedMembers.map((m: any) => {
              const u = m.user;
              if (!u) return null;
              const isCreator = project.createdById === u.id;
              const badge = u.role === 'ADMIN' ? 'bg-purple-100 text-purple-800' : u.role === 'MANAGER' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800';
              return (
                <div key={m.id} className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl shadow-2xs">
                  <div className="text-xs">
                    <span className="font-bold text-slate-800 mr-1.5">{u.fullName}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${badge}`}>
                      {u.role === 'ADMIN' ? 'Admin' : u.role === 'MANAGER' ? 'Manager' : 'Field Staff'}
                    </span>
                    {isCreator && <span className="ml-1 text-[10px] text-slate-400 font-semibold">(Creator)</span>}
                  </div>
                  {(currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER') && !isCreator && (
                    <button
                      onClick={() => handleRemoveMember(u.id, u.fullName)}
                      className="text-slate-400 hover:text-red-600 text-xs font-bold ml-1"
                      title="Remove member from project"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Documents Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-slate-800">Project Documents</h2>
            <p className="text-xs text-slate-500">Upload RFIs for materials/valves, and ITPs for inspection activities</p>
          </div>
          <div className="flex items-center gap-2">
            <label className={`bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 cursor-pointer text-sm font-medium flex items-center gap-1.5 shadow-sm transition ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              📄 Upload RFI
              <input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv" onChange={(e) => handleUpload(e, 'RFI')} className="hidden" />
            </label>
            <label className={`bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 cursor-pointer text-sm font-medium flex items-center gap-1.5 shadow-sm transition ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              📋 Upload ITP
              <input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv" onChange={(e) => handleUpload(e, 'ITP')} className="hidden" />
            </label>
            <label className={`bg-slate-100 text-slate-700 border border-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-200 cursor-pointer text-sm font-medium flex items-center gap-1.5 transition ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
              📎 Other Doc
              <input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv" onChange={(e) => handleUpload(e)} className="hidden" />
            </label>
          </div>
        </div>
        {documents.length === 0 ? <p className="text-slate-500 text-sm">No documents uploaded yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="text-left p-3 font-medium text-slate-600">File</th><th className="text-left p-3 font-medium text-slate-600">Type</th><th className="text-left p-3 font-medium text-slate-600">Doc No.</th><th className="text-left p-3 font-medium text-slate-600">Status</th><th className="text-right p-3 font-medium text-slate-600">Actions</th></tr></thead>
            <tbody>
              {documents.map((doc: any) => (
                <tr key={doc.id} className="border-t border-slate-100">
                  <td className="p-3 font-medium text-slate-800">{doc.originalFilename}</td>
                  <td className="p-3"><span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">{doc.documentType}</span></td>
                  <td className="p-3 text-slate-600">{doc.documentNumber || '—'}</td>
                  <td className="p-3">{doc.isVerified ? <span className="text-green-600">✅ Processed</span> : <span className="text-orange-500">⏳ Pending</span>}</td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!doc.isVerified && (
                        <button onClick={() => handleProcess(doc.id)} disabled={processing === doc.id}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium disabled:opacity-50">
                          {processing === doc.id ? 'Processing...' : '🔍 Extract Data'}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteDocument(doc.id, doc.originalFilename)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition text-sm"
                        title="Delete Document"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Inspections Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold text-slate-800">Inspections</h2>
          <button onClick={() => navigate(`/inspections/new?projectId=${id}`)} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium">+ New Inspection</button>
        </div>
        {inspections.length === 0 ? <p className="text-slate-500 text-sm">No inspections created.</p> : (
          <div className="space-y-3">
            {inspections.map((insp: any) => (
              <div key={insp.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:border-blue-300 transition">
                <Link to={`/inspections/${insp.id}`} className="flex-1 block mr-4">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-800 hover:text-blue-600">{insp.reportNumber}</span>
                    <StatusBadge status={insp.status} />
                  </div>
                  <div className="text-sm text-slate-500 mt-1">{insp.inspectionType} — {insp.location} — {new Date(insp.startDate).toLocaleDateString()}</div>
                </Link>
                <button
                  onClick={() => handleDeleteInspection(insp.id, insp.reportNumber)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                  title="Delete Inspection"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Project Details Modal with Autocomplete */}
      {showEditProjectModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>✏️</span> Edit Project Details
              </h3>
              <button onClick={() => setShowEditProjectModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <p className="text-sm text-slate-600">
              Update customer, supplier, or location details. Previously entered records appear automatically in the dropdown.
            </p>
            <div className="space-y-3 py-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Project Name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={editProjectForm.projectName}
                  onChange={e => setEditProjectForm({ ...editProjectForm, projectName: e.target.value })}
                  placeholder="Project Name"
                />
              </div>
              <AutocompleteInput
                label="Customer"
                category="customer"
                value={editProjectForm.customerName}
                onChange={v => setEditProjectForm({ ...editProjectForm, customerName: v })}
                placeholder="e.g. ADNOC Onshore"
                required
              />
              <AutocompleteInput
                label="Supplier"
                category="supplier"
                value={editProjectForm.supplierName}
                onChange={v => setEditProjectForm({ ...editProjectForm, supplierName: v })}
                placeholder="e.g. KSB MIL Controls Limited"
                required
              />
              <AutocompleteInput
                label="Supplier Location"
                category="location"
                value={editProjectForm.supplierAddress}
                onChange={v => setEditProjectForm({ ...editProjectForm, supplierAddress: v })}
                placeholder="e.g. Meladoor, Kerala"
              />
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">PO Number</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={editProjectForm.poNumber}
                  onChange={e => setEditProjectForm({ ...editProjectForm, poNumber: e.target.value })}
                  placeholder="PO Number"
                />
              </div>
            </div>
            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowEditProjectModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveProject}
                disabled={savingProject || !editProjectForm.customerName.trim() || !editProjectForm.supplierName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {savingProject ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// New Inspection Page
// ============================================================
function NewInspectionPage({ currentUser }: { currentUser?: any }) {
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(window.location.search);
  const projectId = searchParams.get('projectId') || '';
  const [projects, setProjects] = useState<any[]>([]);
  const [teamUsers, setTeamUsers] = useState<any[]>([]);
  const canAssignStaff = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  const [form, setForm] = useState(() => {
    const draft = loadDraft<any>('new_inspection');
    return draft?.data || {
      projectId,
      reportNumber: '',
      inspectionType: 'FAT',
      location: '',
      startDate: new Date().toISOString().slice(0, 10),
      inspectorId: currentUser?.id || '',
    };
  });

  useEffect(() => {
    API.getProjects().then(r => setProjects(r.data)).catch(() => {});
    if (canAssignStaff) {
      API.getUsers().then(r => setTeamUsers(r.data)).catch(() => {});
    }
  }, [canAssignStaff]);

  useEffect(() => {
    if (currentUser?.id && !form.inspectorId) {
      setForm((prev: any) => ({ ...prev, inspectorId: currentUser.id }));
    }
  }, [currentUser]);

  // Auto-save draft on change
  useEffect(() => {
    if (form.reportNumber || form.location || form.projectId) {
      saveDraft('new_inspection', form);
    }
  }, [form]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await API.createInspection(form);
      clearDraft('new_inspection');
      navigate(`/inspections/${r.data.id}`);
    } catch { alert('Failed to create inspection'); }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">New Inspection</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        {loadDraft('new_inspection') && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-1.5 rounded-lg flex items-center justify-between">
            <span>🛡️ Restored unsaved inspection draft from your previous session.</span>
            <button
              type="button"
              onClick={() => {
                clearDraft('new_inspection');
                setForm({
                  projectId,
                  reportNumber: '',
                  inspectionType: 'FAT',
                  location: '',
                  startDate: new Date().toISOString().slice(0, 10),
                  inspectorId: currentUser?.id || '',
                });
              }}
              className="text-amber-900 underline font-semibold ml-2"
            >
              Discard Draft
            </button>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Project</label>
          <select
            value={form.projectId}
            onChange={e => {
              const pId = e.target.value;
              const proj = projects.find((p: any) => p.id === pId);
              setForm((prev: any) => ({
                ...prev,
                projectId: pId,
                ...(!prev.location && proj?.supplierAddress ? { location: proj.supplierAddress } : {}),
              }));
            }}
            className="w-full px-3 py-2 border rounded-lg"
            required
          >
            <option value="">Select project...</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.projectNumber} — {p.projectName}</option>)}
          </select>
        </div>

        {form.projectId && (() => {
          const selectedProj = projects.find((p: any) => p.id === form.projectId);
          if (!selectedProj) return null;
          return (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs flex flex-wrap gap-4 text-slate-600">
              <div><span className="font-semibold text-slate-700">Customer:</span> {selectedProj.customerName}</div>
              <div><span className="font-semibold text-slate-700">Supplier:</span> {selectedProj.supplierName}</div>
              {selectedProj.supplierAddress && <div><span className="font-semibold text-slate-700">Supplier Location:</span> {selectedProj.supplierAddress}</div>}
            </div>
          );
        })()}

        {canAssignStaff && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Assign Field Staff / Inspector
            </label>
            <select
              value={form.inspectorId || currentUser?.id || ''}
              onChange={e => setForm({ ...form, inspectorId: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value={currentUser?.id}>Me ({currentUser?.fullName})</option>
              {teamUsers
                .filter(u => u.id !== currentUser?.id)
                .map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.role === 'INSPECTOR' ? 'Field Staff' : u.role}) - {u.email}
                  </option>
                ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {currentUser?.role === 'ADMIN'
                ? 'Admin: You can assign this inspection to any staff member.'
                : 'Manager: You can assign this inspection to yourself or any field staff reporting to you.'}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input label="Report Number" value={form.reportNumber} onChange={v => setForm({ ...form, reportNumber: v })} placeholder="001" required />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Inspection Type</label>
            <select value={form.inspectionType} onChange={e => setForm({ ...form, inspectionType: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
              <option>FAT</option><option>Stage Inspection</option><option>Final Inspection</option><option>Pre-Inspection Meeting</option>
            </select>
          </div>
          <AutocompleteInput label="Location" category="location" value={form.location} onChange={v => setForm({ ...form, location: v })} placeholder="Meladoor, Kerala" required />
          <Input label="Start Date" value={form.startDate} onChange={v => setForm({ ...form, startDate: v })} type="date" required />
        </div>
        <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium">Create Inspection</button>
      </form>
    </div>
  );
}

// ============================================================
// Inspection Workspace Page (THE MAIN PAGE)
// ============================================================
function InspectionWorkspacePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [validation, setValidation] = useState<any>(null);

  // RFI Selection & Import state
  const [showRfiModal, setShowRfiModal] = useState(false);
  const [rfiDocs, setRfiDocs] = useState<any[]>([]);
  const [uploadingRfi, setUploadingRfi] = useState(false);
  const [importingRfi, setImportingRfi] = useState(false);

  // ITP Selection & Import state
  const [showItpModal, setShowItpModal] = useState(false);
  const [itpDocs, setItpDocs] = useState<any[]>([]);
  const [uploadingItp, setUploadingItp] = useState(false);
  const [importingItp, setImportingItp] = useState(false);
  const [recallingRfi, setRecallingRfi] = useState(false);

  // Customer Offer List state
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerDocs, setOfferDocs] = useState<any[]>([]);

  // Location edit state
  const [showEditLocationModal, setShowEditLocationModal] = useState(false);
  const [editLocationValue, setEditLocationValue] = useState('');
  const [savingLocation, setSavingLocation] = useState(false);

  // Full Details & Scope edit state
  const [showEditDetailsModal, setShowEditDetailsModal] = useState(false);
  const [detailsForm, setDetailsForm] = useState({
    supplierName: '',
    supplierAddress: '',
    customerName: '',
    customerAddress: '',
    poNumber: '',
    projectName: '',
    location: '',
    materialDescription: '',
    itpNumber: '',
    itpRevision: '',
    reportNumber: '',
    disposition: '',
    summaryNarrative: '',
  });
  const [savingDetails, setSavingDetails] = useState(false);

  const openEditDetailsModal = () => {
    if (!inspection) return;
    setDetailsForm({
      supplierName: inspection.project?.supplierName || '',
      supplierAddress: inspection.project?.supplierAddress || '',
      customerName: inspection.project?.customerName || '',
      customerAddress: inspection.project?.customerAddress || '',
      poNumber: inspection.project?.poNumber || '',
      projectName: inspection.project?.projectName || '',
      location: inspection.location || '',
      materialDescription: inspection.materialDescription || 'CONTROL VALVES AND ITS COMPONENTS',
      itpNumber: inspection.itpNumber || '',
      itpRevision: inspection.itpRevision || '',
      reportNumber: inspection.reportNumber || '',
      disposition: inspection.disposition || 'Accept',
      summaryNarrative: inspection.summaryNarrative || '',
    });
    setShowEditDetailsModal(true);
  };

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !inspection) return;
    setSavingDetails(true);
    try {
      await API.updateInspection(id, {
        location: detailsForm.location,
        materialDescription: detailsForm.materialDescription,
        itpNumber: detailsForm.itpNumber,
        itpRevision: detailsForm.itpRevision,
        reportNumber: detailsForm.reportNumber,
        disposition: detailsForm.disposition,
        summaryNarrative: detailsForm.summaryNarrative,
      });

      if (inspection.projectId) {
        await API.updateProject(inspection.projectId, {
          supplierName: detailsForm.supplierName,
          supplierAddress: detailsForm.supplierAddress,
          customerName: detailsForm.customerName,
          customerAddress: detailsForm.customerAddress,
          poNumber: detailsForm.poNumber,
          projectName: detailsForm.projectName,
        });
      }

      setShowEditDetailsModal(false);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update details');
    } finally {
      setSavingDetails(false);
    }
  };

  const load = useCallback(() => {
    if (!id) return;
    API.getInspection(id).then(r => setInspection(r.data)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const handleSaveLocation = async () => {
    if (!id) return;
    setSavingLocation(true);
    try {
      await API.updateInspection(id, { location: editLocationValue });
      setShowEditLocationModal(false);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update location');
    } finally {
      setSavingLocation(false);
    }
  };

  const loadRfiDocuments = async () => {
    if (!inspection?.projectId) return;
    try {
      const res = await API.getDocuments(inspection.projectId);
      const sorted = [...(res.data || [])].sort((a: any, b: any) => {
        const aIsRfi = (a.documentType === 'RFI' || a.originalFilename.toLowerCase().includes('rfi')) ? 1 : 0;
        const bIsRfi = (b.documentType === 'RFI' || b.originalFilename.toLowerCase().includes('rfi')) ? 1 : 0;
        return bIsRfi - aIsRfi;
      });
      setRfiDocs(sorted);
      setShowRfiModal(true);
    } catch {
      alert('Failed to load project documents');
    }
  };

  const loadItpDocuments = async () => {
    if (!inspection?.projectId) return;
    try {
      const res = await API.getDocuments(inspection.projectId);
      const sorted = [...(res.data || [])].sort((a: any, b: any) => {
        const aIsItp = (a.documentType === 'ITP' || a.originalFilename.toLowerCase().includes('itp') || a.originalFilename.toLowerCase().includes('plan')) ? 1 : 0;
        const bIsItp = (b.documentType === 'ITP' || b.originalFilename.toLowerCase().includes('itp') || b.originalFilename.toLowerCase().includes('plan')) ? 1 : 0;
        return bIsItp - aIsItp;
      });
      setItpDocs(sorted);
      setShowItpModal(true);
    } catch {
      alert('Failed to load project documents');
    }
  };

  const loadOfferDocuments = async () => {
    if (!inspection?.projectId) return;
    try {
      const res = await API.getDocuments(inspection.projectId);
      setOfferDocs(res.data || []);
      setShowOfferModal(true);
    } catch {
      alert('Failed to load project documents');
    }
  };

  const handleImportRfi = async (docId: string) => {
    setImportingRfi(true);
    try {
      const res = await API.importRFI(inspection.id, docId);
      alert(res.data.message || 'Successfully imported materials and activities from RFI!');
      setShowRfiModal(false);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to import from RFI');
    }
    setImportingRfi(false);
  };

  const handleUploadAndImportRfi = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploadingRfi(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', inspection.projectId);
    fd.append('documentType', 'RFI');
    try {
      const uploadRes = await API.uploadDocument(fd);
      await handleImportRfi(uploadRes.data.id);
    } catch {
      alert('Failed to upload RFI');
    }
    setUploadingRfi(false);
    e.target.value = '';
  };

  const handleImportItp = async (docId: string) => {
    setImportingItp(true);
    try {
      const res = await API.importITP(inspection.id, docId);
      alert(res.data.message || 'Successfully imported activities from ITP!');
      setShowItpModal(false);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to import from ITP');
    }
    setImportingItp(false);
  };

  const handleUploadAndImportItp = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploadingItp(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', inspection.projectId);
    fd.append('documentType', 'ITP');
    try {
      const uploadRes = await API.uploadDocument(fd);
      await handleImportItp(uploadRes.data.id);
    } catch {
      alert('Failed to upload ITP');
    }
    setUploadingItp(false);
    e.target.value = '';
  };

  const handleRecallRfi = async () => {
    if (!inspection.rfiDocumentId) {
      alert('No RFI document is currently linked. Please upload or link an RFI first.');
      loadRfiDocuments();
      return;
    }
    if (!confirm(`Recall data from RFI "${inspection.rfiDocument?.originalFilename}"? This will restore and re-sync all materials extracted from the RFI.`)) return;
    setRecallingRfi(true);
    try {
      const res = await API.recallRFI(inspection.id);
      alert(res.data.message || 'Materials successfully recalled from RFI!');
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to recall RFI data');
    } finally {
      setRecallingRfi(false);
    }
  };

  if (!inspection) return <div className="text-center py-12 text-slate-500">Loading inspection...</div>;

  const tabs = [
    { key: 'overview', label: '📊 Overview' },
    { key: 'items', label: `🔧 Items (${inspection.items?.length || 0})` },
    { key: 'activities', label: `📋 Activities (${inspection.activities?.length || 0})` },
    { key: 'results', label: `📝 Results (${inspection.results?.length || 0})` },
    { key: 'instruments', label: `🛠️ Equipment (5.0) (${inspection.instruments?.length || 0})` },
    { key: 'attendees', label: `👥 Attendees (${inspection.attendees?.length || 0})` },
    { key: 'photos', label: `📸 Photos (${inspection.photos?.length || 0})` },
    { key: 'observations', label: `📌 Observations` },
    { key: 'report', label: '📄 Report' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-600">← Back</button>
          <h1 className="text-2xl font-bold text-slate-800">{inspection.reportNumber}</h1>
          <StatusBadge status={inspection.status} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openEditDetailsModal}
            className="px-3.5 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-semibold transition flex items-center gap-1.5 shadow-xs"
            title="Edit supplier, location, customer, scope description, ITP & report metadata"
          >
            ✏️ Edit Scope & Details
          </button>
          <button
            onClick={async () => {
              if (!confirm(`Are you sure you want to delete inspection ${inspection.reportNumber}? All associated items, activities, results, photos, and report data will be deleted.`)) return;
              try {
                await API.deleteInspection(inspection.id);
                navigate(inspection.projectId ? `/projects/${inspection.projectId}` : '/inspections');
              } catch (err: any) {
                alert(err.response?.data?.error || 'Failed to delete inspection');
              }
            }}
            className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm font-semibold transition flex items-center gap-1.5"
          >
            🗑️ Delete Inspection
          </button>
        </div>
      </div>

      {/* Progress / Info bar with Linked RFI, ITP, and Customer Offer List */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 shadow-xs">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 text-sm items-center">
          <div><span className="text-slate-500">Project:</span> <span className="font-medium">{inspection.project?.projectNumber}</span></div>
          <div><span className="text-slate-500">Type:</span> <span className="font-medium">{inspection.inspectionType}</span></div>
          <div><span className="text-slate-500">Date:</span> <span className="font-medium">{new Date(inspection.startDate).toLocaleDateString()}</span></div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Location:</span>
              <button
                type="button"
                onClick={() => {
                  setEditLocationValue(inspection.location || '');
                  setShowEditLocationModal(true);
                }}
                className="text-xs text-blue-600 hover:text-blue-800 underline font-medium ml-1"
                title="Edit Inspection Location"
              >
                Edit
              </button>
            </div>
            <span className="font-medium truncate block" title={inspection.location}>{inspection.location || '—'}</span>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Supplier:</span>
              <button
                type="button"
                onClick={openEditDetailsModal}
                className="text-xs text-blue-600 hover:text-blue-800 underline font-medium ml-1"
                title="Edit Supplier Details"
              >
                Edit
              </button>
            </div>
            <span className="font-medium truncate block" title={inspection.project?.supplierName}>{inspection.project?.supplierName || '—'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-xs">Linked RFI:</span>{' '}
            {inspection.rfiDocument ? (
              <div className="inline-flex items-center gap-1.5 mt-0.5">
                <span className="font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-xs truncate max-w-[100px]" title={inspection.rfiDocument.originalFilename}>
                  📄 {inspection.rfiDocument.originalFilename}
                </span>
                <button onClick={loadRfiDocuments} className="text-blue-600 hover:text-blue-800 text-[11px] underline" title="Change RFI">Change</button>
              </div>
            ) : (
              <button onClick={loadRfiDocuments} className="text-blue-600 hover:text-blue-800 text-xs font-semibold underline mt-0.5 block">
                + Upload/Link RFI
              </button>
            )}
          </div>
          <div>
            <span className="text-slate-500 block text-xs">Linked ITP:</span>{' '}
            {inspection.itpDocument ? (
              <div className="inline-flex items-center gap-1.5 mt-0.5">
                <span className="font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-xs truncate max-w-[100px]" title={inspection.itpDocument.originalFilename}>
                  📋 {inspection.itpDocument.originalFilename}
                </span>
                <button onClick={loadItpDocuments} className="text-emerald-700 hover:text-emerald-900 text-[11px] underline" title="Change ITP">Change</button>
              </div>
            ) : (
              <button onClick={loadItpDocuments} className="text-emerald-600 hover:text-emerald-800 text-xs font-semibold underline mt-0.5 block">
                + Upload/Link ITP
              </button>
            )}
          </div>
          <div>
            <span className="text-slate-500 block text-xs">Offer List:</span>{' '}
            {inspection.offerDocument || inspection.offerReference ? (
              <div className="inline-flex items-center gap-1.5 mt-0.5">
                <span className="font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded text-xs truncate max-w-[100px]" title={inspection.offerDocument?.originalFilename || inspection.offerReference}>
                  📜 {inspection.offerDocument?.originalFilename || inspection.offerReference}
                </span>
                <button onClick={loadOfferDocuments} className="text-purple-700 hover:text-purple-900 text-[11px] underline" title="Change Offer List">Change</button>
              </div>
            ) : (
              <button onClick={loadOfferDocuments} className="text-purple-600 hover:text-purple-800 text-xs font-semibold underline mt-0.5 block">
                + Add Offer List
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-2">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${activeTab === t.key ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        {activeTab === 'overview' && <OverviewTab inspection={inspection} onValidate={async () => {
          const r = await API.validateInspection(id!);
          setValidation(r.data);
        }} validation={validation} onOpenRfiModal={loadRfiDocuments} onOpenItpModal={loadItpDocuments} onOpenOfferModal={loadOfferDocuments} onRecallRfi={handleRecallRfi} recallingRfi={recallingRfi} onOpenEditDetailsModal={openEditDetailsModal} />}
        {activeTab === 'items' && <ItemsTab inspection={inspection} onReload={load} onOpenRfiModal={loadRfiDocuments} onOpenOfferModal={loadOfferDocuments} onRecallRfi={handleRecallRfi} recallingRfi={recallingRfi} />}
        {activeTab === 'activities' && <ActivitiesTab inspection={inspection} onReload={load} onOpenRfiModal={loadRfiDocuments} onOpenItpModal={loadItpDocuments} onOpenOfferModal={loadOfferDocuments} />}
        {activeTab === 'results' && <ResultsTab inspection={inspection} onReload={load} />}
        {activeTab === 'instruments' && <InstrumentsTab inspection={inspection} onReload={load} />}
        {activeTab === 'attendees' && <AttendeesTab inspection={inspection} onReload={load} />}
        {activeTab === 'photos' && <PhotosTab inspection={inspection} onReload={load} />}
        {activeTab === 'observations' && <ObservationsTab inspection={inspection} onReload={load} />}
        {activeTab === 'report' && <ReportTab inspection={inspection} onReload={load} />}
      </div>

      {/* RFI Import Modal (Accessible from all tabs) */}
      {showRfiModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>📄</span> Select or Upload RFI Document
              </h3>
              <button onClick={() => setShowRfiModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <p className="text-sm text-slate-600">
              Select or upload a Request For Inspection (RFI) to extract materials, valves, equipment tags, and project metadata. Only materials from the RFI will be considered.
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {rfiDocs.length === 0 ? (
                <div className="p-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
                  <p className="text-sm text-slate-500">No RFI documents found in this project yet.</p>
                  <p className="text-xs text-slate-400">Upload a new RFI file below.</p>
                </div>
              ) : (
                rfiDocs.map((doc: any) => {
                  const isCurrent = inspection.rfiDocumentId === doc.id;
                  const isRfi = doc.documentType === 'RFI' || doc.originalFilename.toLowerCase().includes('rfi');
                  return (
                    <div key={doc.id} className={`flex items-center justify-between p-3 border rounded-xl transition ${isCurrent ? 'border-blue-500 bg-blue-50/40' : 'border-slate-200 hover:bg-slate-50'}`}>
                      <div className="flex-1 mr-3 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-slate-800 truncate" title={doc.originalFilename}>{doc.originalFilename}</p>
                          {isCurrent && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">Current</span>}
                          {isRfi && !isCurrent && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">RFI</span>}
                        </div>
                        <p className="text-xs text-slate-500">{doc.documentType} • {(doc.fileSizeBytes / 1024).toFixed(0)} KB {doc.isVerified ? '• ✅ Processed' : ''}</p>
                      </div>
                      <button
                        onClick={() => handleImportRfi(doc.id)}
                        disabled={importingRfi}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50 whitespace-nowrap"
                      >
                        {importingRfi ? 'Importing...' : isCurrent ? 'Re-import' : 'Import Materials'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <label className={`bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition ${uploadingRfi ? 'opacity-50' : ''}`}>
                {uploadingRfi ? 'Uploading...' : '📤 Upload New RFI (.pdf, .docx, .xlsx, .csv)'}
                <input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv" onChange={handleUploadAndImportRfi} className="hidden" />
              </label>
              <button onClick={() => setShowRfiModal(false)} className="text-slate-500 hover:text-slate-700 text-sm font-medium">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ITP Import Modal */}
      {showItpModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>📋</span> Select or Upload ITP Document
              </h3>
              <button onClick={() => setShowItpModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <p className="text-sm text-slate-600">
              Select or upload an approved Inspection &amp; Test Plan (ITP) to extract clauses, inspection activities, intervention levels, and acceptance criteria into this inspection.
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {itpDocs.length === 0 ? (
                <div className="p-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-2">
                  <p className="text-sm text-slate-500">No ITP documents found in this project yet.</p>
                  <p className="text-xs text-slate-400">Upload an ITP document below to extract activities.</p>
                </div>
              ) : (
                itpDocs.map((doc: any) => {
                  const isCurrent = inspection.itpDocumentId === doc.id;
                  const isItp = doc.documentType === 'ITP' || doc.originalFilename.toLowerCase().includes('itp');
                  return (
                    <div key={doc.id} className={`flex items-center justify-between p-3 border rounded-xl transition ${isCurrent ? 'border-emerald-500 bg-emerald-50/40' : 'border-slate-200 hover:bg-slate-50'}`}>
                      <div className="flex-1 mr-3 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-slate-800 truncate" title={doc.originalFilename}>{doc.originalFilename}</p>
                          {isCurrent && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Current</span>}
                          {isItp && !isCurrent && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">ITP</span>}
                        </div>
                        <p className="text-xs text-slate-500">{doc.documentType} • {(doc.fileSizeBytes / 1024).toFixed(0)} KB {doc.isVerified ? '• ✅ Processed' : ''}</p>
                      </div>
                      <button
                        onClick={() => handleImportItp(doc.id)}
                        disabled={importingItp}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50 whitespace-nowrap"
                      >
                        {importingItp ? 'Importing...' : isCurrent ? 'Re-import' : 'Import Activities'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <label className={`bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition ${uploadingItp ? 'opacity-50' : ''}`}>
                {uploadingItp ? 'Uploading...' : '📤 Upload New ITP (.pdf, .docx, .doc)'}
                <input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv" onChange={handleUploadAndImportItp} className="hidden" />
              </label>
              <button onClick={() => setShowItpModal(false)} className="text-slate-500 hover:text-slate-700 text-sm font-medium">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Location Modal */}
      {showEditLocationModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>📍</span> Edit Inspection Location
              </h3>
              <button onClick={() => setShowEditLocationModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <p className="text-sm text-slate-600">
              Select a previously entered location from the auto dropdown or type a new one. Newly entered locations will automatically be saved for future searches.
            </p>
            <div className="py-2">
              <AutocompleteInput
                label="Location"
                category="location"
                value={editLocationValue}
                onChange={setEditLocationValue}
                placeholder="e.g. Meladoor, Kerala or Jebel Ali, Dubai"
                required
              />
            </div>
            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowEditLocationModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveLocation}
                disabled={savingLocation || !editLocationValue.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {savingLocation ? 'Saving...' : 'Save Location'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Scope, Supplier & Inspection Details Modal */}
      {showEditDetailsModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>✏️</span> Edit Inspection, Supplier &amp; Scope Details
              </h3>
              <button onClick={() => setShowEditDetailsModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <form onSubmit={handleSaveDetails} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AutocompleteInput
                  label="Supplier Name"
                  category="supplier"
                  value={detailsForm.supplierName}
                  onChange={v => setDetailsForm({ ...detailsForm, supplierName: v })}
                  placeholder="e.g. KSB MIL Controls Limited"
                  required
                />
                <Input
                  label="Supplier Address"
                  value={detailsForm.supplierAddress}
                  onChange={v => setDetailsForm({ ...detailsForm, supplierAddress: v })}
                  placeholder="e.g. Meladoor, Annamanada - 680741, Kerala"
                />
                <AutocompleteInput
                  label="Inspection Location"
                  category="location"
                  value={detailsForm.location}
                  onChange={v => setDetailsForm({ ...detailsForm, location: v })}
                  placeholder="e.g. Meladoor, Kerala"
                  required
                />
                <AutocompleteInput
                  label="Customer Name"
                  category="customer"
                  value={detailsForm.customerName}
                  onChange={v => setDetailsForm({ ...detailsForm, customerName: v })}
                  placeholder="e.g. ADNOC Onshore"
                  required
                />
                <Input
                  label="Customer Address"
                  value={detailsForm.customerAddress}
                  onChange={v => setDetailsForm({ ...detailsForm, customerAddress: v })}
                  placeholder="e.g. P.O. Box 270, Abu Dhabi, UAE"
                />
                <Input
                  label="Contractor PO Number"
                  value={detailsForm.poNumber}
                  onChange={v => setDetailsForm({ ...detailsForm, poNumber: v })}
                  placeholder="e.g. 04108-PM-INST-008"
                />
                <div className="md:col-span-2">
                  <Input
                    label="Project Name"
                    value={detailsForm.projectName}
                    onChange={v => setDetailsForm({ ...detailsForm, projectName: v })}
                    placeholder="e.g. EPC for SE AiP5 Project (On plot) - ASAB/SAHIL (Package 1)"
                  />
                </div>
                <div className="md:col-span-2">
                  <Input
                    label="Materials / Scope Description (Section 2.0)"
                    value={detailsForm.materialDescription}
                    onChange={v => setDetailsForm({ ...detailsForm, materialDescription: v })}
                    placeholder="e.g. CONTROL VALVES AND ITS COMPONENTS"
                    required
                  />
                </div>
                <Input
                  label="ITP Number Reference"
                  value={detailsForm.itpNumber}
                  onChange={v => setDetailsForm({ ...detailsForm, itpNumber: v })}
                  placeholder="e.g. P30339B-30-99-52-4607"
                />
                <Input
                  label="ITP Revision"
                  value={detailsForm.itpRevision}
                  onChange={v => setDetailsForm({ ...detailsForm, itpRevision: v })}
                  placeholder="e.g. Rev C"
                />
                <Input
                  label="Report Number"
                  value={detailsForm.reportNumber}
                  onChange={v => setDetailsForm({ ...detailsForm, reportNumber: v })}
                  placeholder="e.g. 001"
                />
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Inspection Disposition</label>
                  <select
                    value={detailsForm.disposition}
                    onChange={e => setDetailsForm({ ...detailsForm, disposition: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm"
                  >
                    <option value="Acceptable">Acceptable</option>
                    <option value="Nonconformance(s) Identified">Nonconformance(s) Identified</option>
                    <option value="Placed on Hold">Placed on Hold</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Inspection Summary Narrative (Page 1)</label>
                  <textarea
                    value={detailsForm.summaryNarrative}
                    onChange={e => setDetailsForm({ ...detailsForm, summaryNarrative: e.target.value })}
                    rows={3}
                    placeholder="Leave blank to auto-synthesize from attended ITP clauses, or provide custom summary."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditDetailsModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDetails}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition disabled:opacity-50"
                >
                  {savingDetails ? 'Saving Changes...' : 'Save All Details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Offer List Modal */}
      <OfferListModal
        inspection={inspection}
        offerDocs={offerDocs}
        isOpen={showOfferModal}
        onClose={() => setShowOfferModal(false)}
        onReload={load}
      />
    </div>
  );
}

// Modal: Customer Offer List & Auto-Selection
function OfferListModal({ inspection, offerDocs, isOpen, onClose, onReload }: { inspection: any; offerDocs: any[]; isOpen: boolean; onClose: () => void; onReload: () => void }) {
  if (!isOpen) return null;

  const [inputMode, setInputMode] = useState<'upload' | 'paste' | 'existing'>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [selectedDocId, setSelectedDocId] = useState('');
  const [offerReference, setOfferReference] = useState(inspection.offerReference || '');
  
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [parseResult, setParseResult] = useState<any | null>(null);

  // Selection states
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedActivityIds, setSelectedActivityIds] = useState<Set<string>>(new Set());
  const [addNewItems, setAddNewItems] = useState(true);
  const [addNewActivities, setAddNewActivities] = useState(true);
  const [activeTab, setActiveTab] = useState<'items' | 'activities'>('items');
  const [itemSearch, setItemSearch] = useState('');
  const [actSearch, setActSearch] = useState('');

  const allItems = inspection.items || [];
  const allActivities = inspection.activities || [];

  const handleAnalyze = async () => {
    if (inputMode === 'upload' && !selectedFile) {
      alert('Please select a file to upload and analyze.');
      return;
    }
    if (inputMode === 'paste' && !pastedText.trim()) {
      alert('Please paste customer offer letter text.');
      return;
    }
    if (inputMode === 'existing' && !selectedDocId) {
      alert('Please select an existing document from the project.');
      return;
    }

    setAnalyzing(true);
    setParseResult(null);

    try {
      let res;
      if (inputMode === 'upload' && selectedFile) {
        const fd = new FormData();
        fd.append('file', selectedFile);
        if (inspection.projectId) fd.append('projectId', inspection.projectId);
        if (offerReference) fd.append('offerReference', offerReference);
        res = await API.parseOfferList(inspection.id, fd);
      } else if (inputMode === 'paste') {
        res = await API.parseOfferList(inspection.id, {
          offerText: pastedText,
          offerReference,
        });
      } else {
        res = await API.parseOfferList(inspection.id, {
          documentId: selectedDocId,
          offerReference,
        });
      }

      const data = res.data;
      setParseResult(data);
      if (data.matchedItemIds) {
        setSelectedItemIds(new Set(data.matchedItemIds));
      }
      if (data.matchedActivityIds) {
        setSelectedActivityIds(new Set(data.matchedActivityIds));
      }
      if (!offerReference && data.offerReference) {
        setOfferReference(data.offerReference);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to analyze offer list');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const payload: any = {
        documentId: parseResult?.documentId || (inputMode === 'existing' ? selectedDocId : undefined),
        offerReference: offerReference || (selectedFile?.name) || 'Customer Offer List',
        selectedItemIds: Array.from(selectedItemIds),
        selectedActivityIds: Array.from(selectedActivityIds),
      };

      if (addNewItems && parseResult?.newItems?.length > 0) {
        payload.newItems = parseResult.newItems;
      }
      if (addNewActivities && parseResult?.newActivities?.length > 0) {
        payload.newActivities = parseResult.newActivities;
      }

      const res = await API.applyOfferList(inspection.id, payload);
      alert(res.data.message || 'Successfully applied offer list selections!');
      onReload();
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to apply offer list');
    } finally {
      setApplying(false);
    }
  };

  const toggleItem = (id: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleActivity = (id: string) => {
    setSelectedActivityIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllMatchedItems = () => {
    if (parseResult?.matchedItemIds) {
      setSelectedItemIds(new Set(parseResult.matchedItemIds));
    }
  };

  const selectAllItems = () => {
    setSelectedItemIds(new Set(allItems.map((i: any) => i.id)));
  };

  const deselectAllItems = () => {
    setSelectedItemIds(new Set());
  };

  const selectAllMatchedActivities = () => {
    if (parseResult?.matchedActivityIds) {
      setSelectedActivityIds(new Set(parseResult.matchedActivityIds));
    }
  };

  const selectAllActivities = () => {
    setSelectedActivityIds(new Set(allActivities.map((a: any) => a.id)));
  };

  const deselectAllActivities = () => {
    setSelectedActivityIds(new Set());
  };

  // Filtered lists
  const filteredItems = allItems.filter((i: any) => {
    if (!itemSearch) return true;
    const q = itemSearch.toLowerCase();
    return (
      (i.tagNumber || '').toLowerCase().includes(q) ||
      (i.serialNumber || '').toLowerCase().includes(q) ||
      (i.poItemNo || '').toLowerCase().includes(q) ||
      (i.itemName || '').toLowerCase().includes(q)
    );
  });

  const filteredActivities = allActivities.filter((a: any) => {
    if (!actSearch) return true;
    const q = actSearch.toLowerCase();
    return (
      (a.clauseNumber || '').toLowerCase().includes(q) ||
      (a.activityName || '').toLowerCase().includes(q)
    );
  });

  const offeredCount = selectedItemIds.size;
  const omittedCount = allItems.length - offeredCount;
  const matchedActCount = selectedActivityIds.size;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-purple-50 via-white to-indigo-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center text-lg font-bold shadow-sm">
              📜
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-800">Customer Offer List &amp; Auto-Selection</h3>
              <p className="text-xs text-slate-500">Auto-detect and select offered valves and scope activities from customer offer letter</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold p-1 rounded-lg hover:bg-slate-100 transition">✕</button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Step 1: Input method tabs */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                1. Provide Offer Letter / Scope
              </label>
              <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setInputMode('upload')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition ${inputMode === 'upload' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  📤 Upload File
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('paste')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition ${inputMode === 'paste' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  📝 Paste Text
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('existing')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition ${inputMode === 'existing' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  📁 Existing Doc
                </button>
              </div>
            </div>

            {inputMode === 'upload' && (
              <div className="border-2 border-dashed border-purple-200 rounded-xl p-5 text-center bg-purple-50/20 hover:bg-purple-50/40 transition">
                <input
                  type="file"
                  id="offer-file-input"
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt"
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
                <label htmlFor="offer-file-input" className="cursor-pointer block space-y-2">
                  <div className="text-3xl">📄</div>
                  {selectedFile ? (
                    <div>
                      <p className="text-sm font-bold text-purple-700">{selectedFile.name}</p>
                      <p className="text-xs text-slate-500">{(selectedFile.size / 1024).toFixed(1)} KB — Click to change file</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-semibold text-purple-800">Click to select customer offer letter</p>
                      <p className="text-xs text-slate-400 mt-1">Supports PDF, DOCX, XLSX, XLS, CSV, or TXT</p>
                    </div>
                  )}
                </label>
              </div>
            )}

            {inputMode === 'paste' && (
              <div className="space-y-1">
                <textarea
                  value={pastedText}
                  onChange={e => setPastedText(e.target.value)}
                  rows={6}
                  placeholder={`Paste customer offer email, letter text, or schedule here...\n\nExample:\nWe offer following control valves for inspection on 26/09/2026:\nItem 1: 14-01-FCV-1601-01A (SL # 25009567)\nItem 2: 14-01-FCV-1601-01B (SL # 25009568)\nScope of testing:\nClause 4.1(a) Hydrostatic test\nClause 4.2(b) Seat leakage test`}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-white"
                />
                <p className="text-xs text-slate-400">The intelligent parser will extract valve tags, serial numbers, PO items, and ITP clause numbers directly from this text.</p>
              </div>
            )}

            {inputMode === 'existing' && (
              <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-200 rounded-xl p-2 bg-slate-50">
                {offerDocs.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 py-4">No documents found in project. Switch to Upload or Paste.</p>
                ) : (
                  offerDocs.map((doc: any) => {
                    const isSelected = selectedDocId === doc.id;
                    const isOffer = (doc.documentType === 'OFFER_LIST' || doc.originalFilename.toLowerCase().includes('offer'));
                    return (
                      <div
                        key={doc.id}
                        onClick={() => setSelectedDocId(doc.id)}
                        className={`p-3 rounded-lg border cursor-pointer transition flex items-center justify-between ${isSelected ? 'border-purple-600 bg-purple-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                      >
                        <div className="min-w-0 mr-2">
                          <p className="font-semibold text-xs text-slate-800 truncate" title={doc.originalFilename}>
                            {doc.originalFilename}
                          </p>
                          <p className="text-[11px] text-slate-500">{doc.documentType} • {(doc.fileSizeBytes / 1024).toFixed(0)} KB</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isOffer && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">Offer</span>}
                          <input type="radio" checked={isSelected} onChange={() => setSelectedDocId(doc.id)} className="text-purple-600" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Offer Reference and Analyze Button */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3 pt-2">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Offer Reference / Subject (Optional)
                </label>
                <input
                  type="text"
                  value={offerReference}
                  onChange={e => setOfferReference(e.target.value)}
                  placeholder="e.g. Email dated 25-09-2026 / Offer Ref # OL-4441"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analyzing}
                className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2 rounded-lg text-sm font-bold shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {analyzing ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    <span>Analyzing Offer Scope...</span>
                  </>
                ) : (
                  <>
                    <span>🔍</span>
                    <span>Analyze Offer List</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Step 2: Analysis Results & Fine-Tuning */}
          {parseResult && (
            <div className="space-y-4 pt-4 border-t border-slate-200">
              {/* Highlight summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl">
                  <span className="text-xs text-purple-600 font-bold block">Offered Items</span>
                  <span className="text-xl font-bold text-purple-900">{offeredCount} of {allItems.length}</span>
                  <span className="text-[11px] text-purple-700 block mt-0.5">({omittedCount} will be omitted)</span>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <span className="text-xs text-emerald-600 font-bold block">Checklist Activities</span>
                  <span className="text-xl font-bold text-emerald-900">{matchedActCount} of {allActivities.length}</span>
                  <span className="text-[11px] text-emerald-700 block mt-0.5">Offered in scope</span>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <span className="text-xs text-blue-600 font-bold block">Tags in Offer</span>
                  <span className="text-xl font-bold text-blue-900">{parseResult.offeredTags?.length || 0}</span>
                  <span className="text-[11px] text-blue-700 block mt-0.5">Identified from document</span>
                </div>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <span className="text-xs text-amber-600 font-bold block">Clauses in Offer</span>
                  <span className="text-xl font-bold text-amber-900">{parseResult.offeredClauses?.length || 0}</span>
                  <span className="text-[11px] text-amber-700 block mt-0.5">ITP clauses detected</span>
                </div>
              </div>

              {/* Notice if new items detected */}
              {parseResult.newItems?.length > 0 && (
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900 flex items-center justify-between gap-3">
                  <div>
                    <span className="font-bold">✨ {parseResult.newItems.length} New Valve(s) Detected in Offer:</span>{' '}
                    <span>{parseResult.newItems.map((n: any) => n.tagNumber).join(', ')}</span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer font-bold whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={addNewItems}
                      onChange={e => setAddNewItems(e.target.checked)}
                      className="rounded text-indigo-600"
                    />
                    <span>Add to inspection</span>
                  </label>
                </div>
              )}

              {/* Notice if new activities detected */}
              {parseResult.newActivities?.length > 0 && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900 flex items-center justify-between gap-3">
                  <div>
                    <span className="font-bold">✨ {parseResult.newActivities.length} New Activity / Clause(s) Detected in Offer:</span>{' '}
                    <span>{parseResult.newActivities.map((n: any) => `Clause ${n.clauseNumber}`).join(', ')}</span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer font-bold whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={addNewActivities}
                      onChange={e => setAddNewActivities(e.target.checked)}
                      className="rounded text-purple-600"
                    />
                    <span>Add to inspection</span>
                  </label>
                </div>
              )}

              {/* Selection Tabs */}
              <div className="space-y-3">
                <div className="flex border-b border-slate-200 gap-4">
                  <button
                    type="button"
                    onClick={() => setActiveTab('items')}
                    className={`pb-2 text-sm font-bold border-b-2 transition ${activeTab === 'items' ? 'border-purple-600 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  >
                    🔧 Offered Valves / Materials ({offeredCount}/{allItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('activities')}
                    className={`pb-2 text-sm font-bold border-b-2 transition ${activeTab === 'activities' ? 'border-purple-600 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                  >
                    📋 Scope Activities ({matchedActCount}/{allActivities.length})
                  </button>
                </div>

                {/* Tab: Items */}
                {activeTab === 'items' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <input
                        type="text"
                        placeholder="Search items by tag, serial, PO..."
                        value={itemSearch}
                        onChange={e => setItemSearch(e.target.value)}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs w-64"
                      />
                      <div className="flex items-center gap-1.5 text-xs">
                        <button
                          type="button"
                          onClick={selectAllMatchedItems}
                          className="px-2.5 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-md font-semibold border border-purple-200 transition"
                        >
                          Select Matched Only ({parseResult.matchedItemIds?.length || 0})
                        </button>
                        <button
                          type="button"
                          onClick={selectAllItems}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-semibold transition"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={deselectAllItems}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-semibold transition"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto divide-y divide-slate-100">
                      {filteredItems.length === 0 ? (
                        <p className="p-4 text-center text-xs text-slate-500">No matching items found.</p>
                      ) : (
                        filteredItems.map((item: any) => {
                          const isOffered = selectedItemIds.has(item.id);
                          return (
                            <div
                              key={item.id}
                              onClick={() => toggleItem(item.id)}
                              className={`p-2.5 flex items-center justify-between text-xs cursor-pointer transition ${isOffered ? 'bg-purple-50/40 hover:bg-purple-50/70' : 'bg-white hover:bg-slate-50 opacity-60'}`}
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={isOffered}
                                  onChange={() => toggleItem(item.id)}
                                  className="rounded text-purple-600 focus:ring-purple-500"
                                />
                                <div>
                                  <span className="font-bold text-slate-800 text-xs">{item.tagNumber}</span>
                                  <span className="text-slate-500 ml-2 font-mono">PO: {item.poItemNo}</span>
                                  {item.serialNumber && <span className="text-slate-500 ml-2">SN: {item.serialNumber}</span>}
                                </div>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isOffered ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                                {isOffered ? 'Offered this Visit' : 'Omitted (Qty: 0)'}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* Tab: Activities */}
                {activeTab === 'activities' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <input
                        type="text"
                        placeholder="Search activities by clause, name..."
                        value={actSearch}
                        onChange={e => setActSearch(e.target.value)}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs w-64"
                      />
                      <div className="flex items-center gap-1.5 text-xs">
                        <button
                          type="button"
                          onClick={selectAllMatchedActivities}
                          className="px-2.5 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-md font-semibold border border-purple-200 transition"
                        >
                          Select Matched Only ({parseResult.matchedActivityIds?.length || 0})
                        </button>
                        <button
                          type="button"
                          onClick={selectAllActivities}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-semibold transition"
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          onClick={deselectAllActivities}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md font-semibold transition"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto divide-y divide-slate-100">
                      {filteredActivities.length === 0 ? (
                        <p className="p-4 text-center text-xs text-slate-500">No matching activities found.</p>
                      ) : (
                        filteredActivities.map((act: any) => {
                          const isSelected = selectedActivityIds.has(act.id);
                          return (
                            <div
                              key={act.id}
                              onClick={() => toggleActivity(act.id)}
                              className={`p-2.5 flex items-center justify-between text-xs cursor-pointer transition ${isSelected ? 'bg-purple-50/40 hover:bg-purple-50/70' : 'bg-white hover:bg-slate-50 opacity-60'}`}
                            >
                              <div className="flex items-center gap-3 min-w-0 mr-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleActivity(act.id)}
                                  className="rounded text-purple-600 focus:ring-purple-500"
                                />
                                <div className="truncate">
                                  <span className="font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded text-[11px] mr-2">
                                    {act.clauseNumber}
                                  </span>
                                  <span className="font-medium text-slate-800">{act.activityName}</span>
                                </div>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${isSelected ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-600'}`}>
                                {isSelected ? 'In Scope' : 'Omitted'}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="text-slate-600 hover:text-slate-800 font-semibold text-sm px-4 py-2"
          >
            Cancel
          </button>

          {parseResult && (
            <button
              type="button"
              onClick={handleApply}
              disabled={applying}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-md transition disabled:opacity-50 flex items-center gap-2"
            >
              {applying ? (
                <>
                  <span className="animate-spin">⏳</span>
                  <span>Applying Selections...</span>
                </>
              ) : (
                <>
                  <span>✅</span>
                  <span>Apply Offer List ({offeredCount} items, {matchedActCount} activities)</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Tab: Overview
function OverviewTab({ inspection, onValidate, validation, onOpenRfiModal, onOpenItpModal, onOpenOfferModal, onRecallRfi, recallingRfi, onOpenEditDetailsModal }: any) {
  const totalAct = inspection.activities?.length || 0;
  const doneAct = inspection.activities?.filter((a: any) => a.status === 'ACCEPTABLE' || a.status === 'NOT_ACCEPTABLE').length || 0;
  const pct = totalAct > 0 ? Math.round((doneAct / totalAct) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Referenced Project Documents & Scope */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
            <span>📄</span> Referenced Project Documents &amp; Scope
          </h4>
          <div className="flex items-center gap-2">
            {onOpenEditDetailsModal && (
              <button
                onClick={onOpenEditDetailsModal}
                className="text-xs font-semibold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg shadow-xs transition flex items-center gap-1"
                title="Edit supplier, location, customer, scope description, and ITP references"
              >
                <span>✏️</span> Edit Scope &amp; Details
              </button>
            )}
            {inspection.rfiDocument && (
              <button
                onClick={onRecallRfi}
                disabled={recallingRfi}
                className="text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 rounded-lg shadow-xs transition flex items-center gap-1 disabled:opacity-50"
                title="Recall and re-sync materials from RFI"
              >
                <span>🔄</span> {recallingRfi ? 'Recalling...' : 'Recall RFI Data'}
              </button>
            )}
            <button
              onClick={onOpenRfiModal}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-xs hover:bg-slate-50 transition"
            >
              {inspection.rfiDocument ? '📄 Change RFI' : '📤 Upload / Link RFI'}
            </button>
            <button
              onClick={onOpenItpModal}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 bg-white border border-slate-200 px-3 py-1.5 rounded-lg shadow-xs hover:bg-slate-50 transition"
            >
              {inspection.itpDocument ? '📋 Change ITP' : '📤 Upload / Link ITP'}
            </button>
            <button
              onClick={onOpenOfferModal}
              className="text-xs font-semibold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-lg shadow-xs transition flex items-center gap-1"
            >
              <span>📜</span> {inspection.offerDocument || inspection.offerReference ? 'Change Offer List' : '📜 Customer Offer List'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <span className="text-slate-500 font-medium block mb-1">Linked RFI Document</span>
            {inspection.rfiDocument ? (
              <span className="font-bold text-blue-700 break-all">{inspection.rfiDocument.originalFilename}</span>
            ) : (
              <span className="text-slate-400 italic">None linked</span>
            )}
          </div>
          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-500 font-medium block">Approved ITP</span>
              {onOpenEditDetailsModal && (
                <button type="button" onClick={onOpenEditDetailsModal} className="text-blue-600 hover:underline text-[11px] font-semibold">Edit</button>
              )}
            </div>
            <span className="font-semibold text-slate-800 block truncate" title={inspection.itpNumber || 'CV-L2-4441 QAP R3/SO'}>
              {inspection.itpNumber || 'CV-L2-4441 QAP R3/SO'} {inspection.itpRevision ? `(Rev ${inspection.itpRevision})` : ''}
            </span>
          </div>
          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-500 font-medium block">Materials / Scope</span>
              {onOpenEditDetailsModal && (
                <button type="button" onClick={onOpenEditDetailsModal} className="text-blue-600 hover:underline text-[11px] font-semibold">Edit</button>
              )}
            </div>
            <span className="font-semibold text-slate-800 block truncate" title={inspection.materialDescription || 'CONTROL VALVES'}>
              {inspection.materialDescription || 'CONTROL VALVES'}
            </span>
          </div>
          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-500 font-medium block">Supplier &amp; Location</span>
              {onOpenEditDetailsModal && (
                <button type="button" onClick={onOpenEditDetailsModal} className="text-blue-600 hover:underline text-[11px] font-semibold">Edit</button>
              )}
            </div>
            <span className="font-semibold text-slate-800 block truncate" title={inspection.project?.supplierName}>{inspection.project?.supplierName || '—'}</span>
            <span className="text-slate-500 text-[11px] block truncate" title={inspection.location}>{inspection.location || '—'}</span>
          </div>
          <div className="bg-white p-3 rounded-lg border border-slate-200">
            <span className="text-slate-500 font-medium block mb-1">Customer Offer List</span>
            {inspection.offerDocument || inspection.offerReference ? (
              <span className="font-bold text-purple-700 break-all">{inspection.offerDocument?.originalFilename || inspection.offerReference}</span>
            ) : (
              <span className="text-slate-400 italic">None linked</span>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-slate-800 mb-3">Progress</h3>
        <div className="w-full bg-slate-200 rounded-full h-4">
          <div className="bg-blue-600 h-4 rounded-full transition-all" style={{ width: `${pct}%` }}></div>
        </div>
        <p className="text-sm text-slate-500 mt-1">{doneAct}/{totalAct} activities completed ({pct}%)</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MiniStat label="Items" value={inspection.items?.length || 0} />
        <MiniStat label="Activities" value={totalAct} />
        <MiniStat label="Results" value={inspection.results?.length || 0} />
        <MiniStat label="Photos" value={inspection.photos?.length || 0} />
      </div>
      <div>
        <button onClick={onValidate} className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 font-medium">🔍 Run Validation</button>
        {validation && (
          <div className="mt-4 space-y-2">
            {validation.errors?.map((e: string, i: number) => <div key={i} className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">❌ {e}</div>)}
            {validation.warnings?.map((w: string, i: number) => <div key={i} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">⚠️ {w}</div>)}
            {validation.errors?.length === 0 && validation.warnings?.length === 0 && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">✅ All validations passed!</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return <div className="p-4 bg-slate-50 rounded-lg text-center"><p className="text-2xl font-bold text-slate-800">{value}</p><p className="text-sm text-slate-500">{label}</p></div>;
}

// Tab: Items / Offered Materials
function ItemsTab({ inspection, onReload, onOpenRfiModal, onOpenOfferModal, onRecallRfi, recallingRfi }: any) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ inspectionId: inspection.id, poItemNo: '', tagNumber: '', serialNumber: '', jobNo: '', itemName: 'Control Valve', sizeInch: '', rating: '', bodyMaterial: '' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<any>(null);
  const [savingItem, setSavingItem] = useState(false);

  const items = inspection.items || [];

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await API.addItem({ ...form, presentedQty: 1, orderedQty: 1 });
    setShowForm(false); onReload();
  };

  const toggleOffered = async (item: any) => {
    const isCurrentlyOffered = item.presentedQty > 0 || item.presentedQty === undefined;
    await API.updateItem(item.id, { presentedQty: isCurrentlyOffered ? 0 : 1 });
    onReload();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i: any) => i.id)));
    }
  };

  const handleDeleteItem = async (itemId: string, tag: string) => {
    if (!confirm(`Are you sure you want to delete valve/equipment "${tag}"?`)) return;
    try {
      await API.deleteItem(itemId);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete item');
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedIds.size} selected material(s)? All associated results will also be deleted.`)) return;
    try {
      const res = await API.deleteItemsBatch(Array.from(selectedIds));
      alert(res.data.message || `Deleted ${selectedIds.size} materials successfully.`);
      setSelectedIds(new Set());
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete selected materials');
    }
  };

  return (
    <div className="space-y-4">
      {/* Sourced from RFI Notice Banner */}
      {inspection.rfiDocument && (
        <div className="bg-blue-50/80 border border-blue-200 text-blue-900 text-xs px-4 py-2.5 rounded-xl flex flex-wrap items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="text-base">📄</span>
            <span>
              <strong>Materials Strictly Sourced from RFI:</strong> Materials are imported from <strong>{inspection.rfiDocument.originalFilename}</strong>. Only offered materials are populated into the official inspection report.
            </span>
          </div>
          <button
            onClick={onRecallRfi}
            disabled={recallingRfi}
            className="text-blue-800 hover:text-blue-950 font-bold underline whitespace-nowrap ml-auto disabled:opacity-50"
            title="Re-read and restore all valves from the RFI"
          >
            {recallingRfi ? '🔄 Recalling...' : '🔄 Recall / Re-sync RFI'}
          </button>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800 text-lg">Offered Equipment &amp; Materials List</h3>
          <p className="text-xs text-slate-500">
            Select which materials/valves are offered for this specific inspection visit. Only offered materials are populated into the inspection report.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              className="bg-red-600 hover:bg-red-700 text-white px-3.5 py-1.5 rounded-lg text-sm font-bold shadow-sm transition flex items-center gap-1.5"
            >
              <span>🗑️</span> Delete Selected ({selectedIds.size})
            </button>
          )}
          <button
            onClick={onOpenOfferModal}
            className="bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-1.5 rounded-lg text-sm font-semibold shadow-sm transition flex items-center gap-1.5"
            title="Upload or paste customer offer list to auto-select offered valves and omit un-offered ones"
          >
            <span>📜</span> Auto-Select from Offer List
          </button>
          <button
            onClick={onRecallRfi}
            disabled={recallingRfi}
            className="bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-1.5 rounded-lg text-sm font-semibold shadow-sm transition flex items-center gap-1.5 disabled:opacity-50"
            title="Re-read and restore all materials directly from the linked RFI"
          >
            <span>🔄</span> {recallingRfi ? 'Recalling...' : 'Recall Data from RFI'}
          </button>
          <button
            onClick={onOpenRfiModal}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-lg text-sm font-semibold shadow-sm transition flex items-center gap-1.5"
          >
            <span>📄</span> Upload / Link RFI
          </button>
          <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-sm font-semibold shadow-sm transition">
            + Add Material Manually
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Input label="PO Item No" value={form.poItemNo} onChange={v => setForm({ ...form, poItemNo: v })} placeholder="'79" required />
            <Input label="Tag Number" value={form.tagNumber} onChange={v => setForm({ ...form, tagNumber: v })} placeholder="14-01-FCV-1601-01A" required />
            <Input label="Serial Number" value={form.serialNumber} onChange={v => setForm({ ...form, serialNumber: v })} placeholder="25009567" required />
            <Input label="Job No" value={form.jobNo} onChange={v => setForm({ ...form, jobNo: v })} placeholder="CD13E085" />
            <Input label="Item Name" value={form.itemName} onChange={v => setForm({ ...form, itemName: v })} />
            <Input label="Size" value={form.sizeInch} onChange={v => setForm({ ...form, sizeInch: v })} placeholder="24''" />
            <Input label="Rating" value={form.rating} onChange={v => setForm({ ...form, rating: v })} placeholder="ASME #600 RF" />
            <Input label="Body Material" value={form.bodyMaterial} onChange={v => setForm({ ...form, bodyMaterial: v })} placeholder="Gr WCC" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Add Material</button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500">Cancel</button>
          </div>
        </form>
      )}

      {(!items || items.length === 0) ? (
        <div className="py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 space-y-3">
          <p className="text-slate-500 text-sm">
            No materials loaded yet. Import or recall an RFI from the project to automatically extract and list all valves.
          </p>
          <div className="flex items-center justify-center gap-2">
            {inspection.rfiDocumentId && (
              <button
                onClick={onRecallRfi}
                className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg font-medium text-sm inline-flex items-center gap-2 shadow-sm transition"
              >
                <span>🔄</span> Recall Materials from Linked RFI
              </button>
            )}
            <button
              onClick={onOpenRfiModal}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium text-sm inline-flex items-center gap-2 shadow-sm transition"
            >
              <span>📥</span> Upload / Link RFI Document
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-xs">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selectedIds.size === items.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                    title="Select / Deselect All for Delete"
                  />
                </th>
                <th className="p-3 text-left font-bold text-slate-700">Offered this Visit</th>
                <th className="p-3 text-left font-bold text-slate-700">PO Item</th>
                <th className="p-3 text-left font-bold text-slate-700">Tag Number</th>
                <th className="p-3 text-left font-bold text-slate-700">Serial No.</th>
                <th className="p-3 text-left font-bold text-slate-700">Job No.</th>
                <th className="p-3 text-left font-bold text-slate-700">Item Name</th>
                <th className="p-3 text-left font-bold text-slate-700">Size / Rating / Material</th>
                <th className="p-3 text-right font-bold text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item: any) => {
                const isOffered = item.presentedQty > 0 || item.presentedQty === undefined;
                const isSelected = selectedIds.has(item.id);
                return (
                  <tr key={item.id} className={`${isSelected ? 'bg-amber-50/60' : isOffered ? 'bg-blue-50/20' : 'bg-slate-50/50 opacity-60'} hover:bg-slate-100/50 transition`}>
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                        title="Select for batch delete"
                      />
                    </td>
                    <td className="p-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isOffered}
                          onChange={() => toggleOffered(item)}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isOffered ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}`}>
                          {isOffered ? 'Offered' : 'Omitted'}
                        </span>
                      </label>
                    </td>
                    <td className="p-3 font-mono font-medium text-slate-700">{item.poItemNo}</td>
                    <td className="p-3 font-bold text-slate-800">{item.tagNumber}</td>
                    <td className="p-3 font-mono text-slate-600">{item.serialNumber}</td>
                    <td className="p-3 font-mono text-slate-600">{item.jobNo}</td>
                    <td className="p-3 text-slate-700">{item.itemName}</td>
                    <td className="p-3 text-xs text-slate-600">
                      {item.sizeInch} {item.rating} • {item.bodyMaterial}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditingItem({ ...item })}
                        className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition text-sm mr-1"
                        title="Edit Material"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id, item.tagNumber)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition text-sm"
                        title="Delete Item"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Material Item Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-8">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>✏️</span> Edit Valve / Material
              </h3>
              <button onClick={() => setEditingItem(null)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setSavingItem(true);
              try {
                await API.updateItem(editingItem.id, editingItem);
                setEditingItem(null);
                onReload();
              } catch (err: any) {
                alert(err.response?.data?.error || 'Failed to update item');
              } finally {
                setSavingItem(false);
              }
            }} className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Input label="PO Item No" value={editingItem.poItemNo} onChange={v => setEditingItem({ ...editingItem, poItemNo: v })} placeholder="'79" required />
                <Input label="Tag Number" value={editingItem.tagNumber} onChange={v => setEditingItem({ ...editingItem, tagNumber: v })} placeholder="14-01-FCV-1601-01A" required />
                <Input label="Serial Number" value={editingItem.serialNumber} onChange={v => setEditingItem({ ...editingItem, serialNumber: v })} placeholder="25009567" />
                <Input label="Job No" value={editingItem.jobNo} onChange={v => setEditingItem({ ...editingItem, jobNo: v })} placeholder="CD13E085" />
                <Input label="Item Name" value={editingItem.itemName} onChange={v => setEditingItem({ ...editingItem, itemName: v })} />
                <Input label="Size" value={editingItem.sizeInch} onChange={v => setEditingItem({ ...editingItem, sizeInch: v })} placeholder="24''" />
                <Input label="Rating" value={editingItem.rating} onChange={v => setEditingItem({ ...editingItem, rating: v })} placeholder="ASME #600 RF" />
                <Input label="Body Material" value={editingItem.bodyMaterial} onChange={v => setEditingItem({ ...editingItem, bodyMaterial: v })} placeholder="Gr WCC" />
                <Input label="Valve Series" value={editingItem.valveSeries || ''} onChange={v => setEditingItem({ ...editingItem, valveSeries: v })} placeholder="41611" />
                <Input label="Presented Qty" type="number" value={String(editingItem.presentedQty ?? 1)} onChange={v => setEditingItem({ ...editingItem, presentedQty: parseInt(v) || 0 })} />
                <Input label="Accepted This Visit" type="number" value={String(editingItem.acceptedThisVisit ?? 1)} onChange={v => setEditingItem({ ...editingItem, acceptedThisVisit: parseInt(v) || 0 })} />
                <Input label="Accepted To Date" type="number" value={String(editingItem.acceptedToDate ?? 1)} onChange={v => setEditingItem({ ...editingItem, acceptedToDate: parseInt(v) || 0 })} />
              </div>
              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button type="button" onClick={() => setEditingItem(null)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium">Cancel</button>
                <button type="submit" disabled={savingItem} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition disabled:opacity-50">
                  {savingItem ? 'Saving...' : 'Save Material'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Tab: Activities & Daily Checklist
function ActivitiesTab({ inspection, onReload, onOpenRfiModal, onOpenItpModal, onOpenOfferModal }: any) {
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState({ inspectionId: inspection.id, clauseNumber: '', activityName: '', acceptanceCriteria: '', interventionTPIA: 'W' });
  const [selectedDate, setSelectedDate] = useState(inspection.startDate ? new Date(inspection.startDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [savingDaily, setSavingDaily] = useState(false);
  const [editingActivity, setEditingActivity] = useState<any>(null);
  const [savingActivity, setSavingActivity] = useState(false);
  
  // Local state for daily checklist entries
  const [entries, setEntries] = useState<Record<string, { isDone: boolean; status: string; remarks: string; testMedium: string; testPressure: string; holdingTimeMin: string }>>({});

  const handleUploadPhotoForActivity = async (actId: string, clause: string, name: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    const fd = new FormData();
    fd.append('file', file);
    fd.append('inspectionId', inspection.id);
    fd.append('activityId', actId);
    fd.append('category', name);
    fd.append('caption', `Clause ${clause} - ${name}`);
    if (inspection.items?.[0]?.id) fd.append('itemId', inspection.items[0].id);
    try {
      await API.uploadPhoto(fd);
      onReload();
    } catch {
      alert('Failed to upload photo for activity');
    }
    e.target.value = '';
  };

  const handleDeleteActivity = async (actId: string, clause: string, name: string) => {
    if (!confirm(`Are you sure you want to delete activity Clause ${clause} (${name})? All recorded results for this activity will also be removed.`)) return;
    try {
      await API.deleteActivity(actId);
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete activity');
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (!confirm('Delete this photo?')) return;
    try {
      await API.deletePhoto(photoId);
      onReload();
    } catch {
      alert('Failed to delete photo');
    }
  };

  const [hasDraftRestored, setHasDraftRestored] = useState(false);

  // Sync entries from inspection activities and results or restored draft
  useEffect(() => {
    const draft = loadDraft<any>(`checklist_${inspection.id}`);
    if (draft?.data && Object.keys(draft.data).length > 0) {
      setEntries(draft.data);
      setHasDraftRestored(true);
      return;
    }
    const map: Record<string, any> = {};
    if (inspection.activities) {
      for (const act of inspection.activities) {
        const result = inspection.results?.find((r: any) => r.activityId === act.id);
        map[act.id] = {
          isDone: act.status === 'ACCEPTABLE' || act.status === 'NOT_ACCEPTABLE' || !!result,
          status: result?.status || act.status || 'ACCEPTABLE',
          remarks: result?.remarks || '',
          testMedium: result?.testMedium || '',
          testPressure: result?.testPressure != null ? String(result.testPressure) : '',
          holdingTimeMin: result?.holdingTimeMin != null ? String(result.holdingTimeMin) : '',
        };
      }
    }
    setEntries(map);
  }, [inspection]);

  const handleSaveDailyChecklist = async () => {
    setSavingDaily(true);
    try {
      const payload = Object.entries(entries).map(([actId, entry]) => ({
        activityId: actId,
        isDone: entry.isDone,
        testDate: selectedDate,
        status: entry.status || 'ACCEPTABLE',
        remarks: entry.remarks,
        testMedium: entry.testMedium,
        testPressure: entry.testPressure ? parseFloat(entry.testPressure) : null,
        holdingTimeMin: entry.holdingTimeMin ? parseFloat(entry.holdingTimeMin) : null,
      }));
      await API.saveDailyChecklist(inspection.id, payload);
      clearDraft(`checklist_${inspection.id}`);
      setHasDraftRestored(false);
      alert('Daily inspection activities and notes saved successfully!');
      onReload();
    } catch {
      alert('Failed to save daily checklist');
    }
    setSavingDaily(false);
  };

  const toggleAll = (done: boolean) => {
    const updated = { ...entries };
    for (const key of Object.keys(updated)) {
      updated[key] = {
        ...updated[key],
        isDone: done,
        status: done ? 'ACCEPTABLE' : 'PENDING',
      };
    }
    setEntries(updated);
  };

  // Auto-save draft on any checklist change
  useEffect(() => {
    if (Object.keys(entries).length > 0) {
      saveDraft(`checklist_${inspection.id}`, entries);
    }
  }, [entries, inspection.id]);

  const activities = inspection.activities || [];
  const completedCount = Object.values(entries).filter(e => e.isDone).length;

  return (
    <div className="space-y-6">
      {hasDraftRestored && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-2.5 rounded-xl flex items-center justify-between">
          <span>🛡️ <strong>Unsaved Checklist Restored:</strong> Recovered your in-progress inspection activities from your previous session.</span>
          <button
            onClick={() => {
              clearDraft(`checklist_${inspection.id}`);
              setHasDraftRestored(false);
              onReload();
            }}
            className="text-amber-950 font-bold underline ml-3"
          >
            Discard Draft & Reload Clean
          </button>
        </div>
      )}
      {/* Top Banner & Quick Actions */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <span>📋</span> Daily Inspection Checklist
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Select the activities performed today, record test parameters or notes, and save.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onOpenItpModal}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-lg font-medium text-sm flex items-center gap-1.5 shadow-sm transition"
            >
              <span>📋</span> Upload / Link ITP
            </button>
            <button
              onClick={onOpenRfiModal}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-lg font-medium text-sm flex items-center gap-1.5 shadow-sm transition"
            >
              <span>📄</span> Import from RFI
            </button>
            <button
              onClick={onOpenOfferModal}
              className="bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-2 rounded-lg font-medium text-sm flex items-center gap-1.5 shadow-sm transition"
              title="Auto-select offered activities from customer offer letter"
            >
              <span>📜</span> Auto-Select from Offer List
            </button>
            <button
              onClick={() => setShowManualForm(!showManualForm)}
              className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg font-medium text-sm transition"
            >
              + Manual Activity
            </button>
          </div>
        </div>

        {/* Date & Progress Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5 pt-4 border-t border-slate-200">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Inspection Activity Date
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex flex-col justify-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Progress</span>
            <span className="text-sm font-bold text-slate-800 mt-1">
              {completedCount} of {activities.length} Activities Completed
            </span>
            <div className="w-full bg-slate-200 rounded-full h-2 mt-1.5 overflow-hidden">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{ width: `${activities.length ? (completedCount / activities.length) * 100 : 0}%` }}
              ></div>
            </div>
          </div>

          <div className="flex items-end justify-end gap-2">
            <button
              onClick={() => toggleAll(true)}
              className="px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition"
            >
              Check All Done
            </button>
            <button
              onClick={() => toggleAll(false)}
              className="px-3 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
            >
              Clear
            </button>
            <button
              onClick={handleSaveDailyChecklist}
              disabled={savingDaily}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-bold text-sm shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
            >
              <span>💾</span> {savingDaily ? 'Saving...' : 'Save Daily Progress'}
            </button>
          </div>
        </div>
      </div>

      {/* Manual Activity Form Modal */}
      {showManualForm && (
        <form onSubmit={async (e) => { e.preventDefault(); await API.addActivity(manualForm); setShowManualForm(false); onReload(); }} className="bg-slate-50 p-4 rounded-xl border border-slate-300 space-y-3">
          <h4 className="font-semibold text-slate-800 text-sm">Add New Activity Manually</h4>
          <div className="grid grid-cols-2 gap-3">
            <Input label="ITP Clause" value={manualForm.clauseNumber} onChange={v => setManualForm({ ...manualForm, clauseNumber: v })} placeholder="7.1" required />
            <Input label="Activity Name" value={manualForm.activityName} onChange={v => setManualForm({ ...manualForm, activityName: v })} placeholder="Body mount Leakage test" required />
            <Input label="Acceptance Criteria" value={manualForm.acceptanceCriteria} onChange={v => setManualForm({ ...manualForm, acceptanceCriteria: v })} placeholder="No leakage at 110% rated pressure" required />
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">TPI Level</label>
              <select value={manualForm.interventionTPIA} onChange={e => setManualForm({ ...manualForm, interventionTPIA: e.target.value })} className="w-full px-3 py-2 border rounded-lg bg-white">
                <option value="H">H - Hold</option><option value="W">W - Witness</option><option value="R">R - Review</option><option value="A">A - Approval</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium">Add Activity</button>
            <button type="button" onClick={() => setShowManualForm(false)} className="text-sm text-slate-500">Cancel</button>
          </div>
        </form>
      )}

      {/* Interactive Activities Checklist Table */}
      {activities.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 p-8">
          <p className="text-slate-500 font-medium mb-3">No inspection activities loaded yet.</p>
          <button
            onClick={onOpenRfiModal}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-bold text-sm shadow transition inline-flex items-center gap-2"
          >
            <span>📥</span> Import Activities Directly From RFI Document
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="divide-y divide-slate-200">
            {activities.map((act: any) => {
              const entry = entries[act.id] || { isDone: false, status: 'ACCEPTABLE', remarks: '', testMedium: '', testPressure: '', holdingTimeMin: '' };
              return (
                <div
                  key={act.id}
                  className={`p-4 transition-colors ${entry.isDone ? 'bg-blue-50/30' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    {/* Activity Title & Checkbox */}
                    <div className="flex items-start gap-3 flex-1">
                      <input
                        type="checkbox"
                        checked={entry.isDone}
                        onChange={e => {
                          const done = e.target.checked;
                          setEntries({
                            ...entries,
                            [act.id]: {
                              ...entry,
                              isDone: done,
                              status: done ? (entry.status === 'PENDING' ? 'ACCEPTABLE' : entry.status) : 'PENDING',
                            },
                          });
                        }}
                        className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-1 cursor-pointer"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm text-blue-700 bg-blue-100 px-2 py-0.5 rounded">
                            Clause {act.clauseNumber}
                          </span>
                          <span className="font-bold text-slate-800 text-sm">{act.activityName}</span>
                          <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                            TPI: {act.interventionTPIA || 'W'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{act.acceptanceCriteria}</p>
                      </div>
                    </div>

                    {/* Result Status Toggle */}
                    <div className="flex items-center gap-2">
                      <select
                        value={entry.status}
                        onChange={e => {
                          setEntries({
                            ...entries,
                            [act.id]: {
                              ...entry,
                              status: e.target.value,
                              isDone: e.target.value !== 'PENDING',
                            },
                          });
                        }}
                        className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border cursor-pointer ${
                          entry.status === 'ACCEPTABLE'
                            ? 'bg-green-100 text-green-800 border-green-300'
                            : entry.status === 'NOT_ACCEPTABLE'
                            ? 'bg-red-100 text-red-800 border-red-300'
                            : entry.status === 'ON_HOLD'
                            ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                            : 'bg-slate-100 text-slate-700 border-slate-300'
                        }`}
                      >
                        <option value="ACCEPTABLE">✅ Acceptable</option>
                        <option value="NOT_ACCEPTABLE">❌ Not Acceptable</option>
                        <option value="ON_HOLD">⏸ On Hold</option>
                        <option value="PENDING">⏳ Pending</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setEditingActivity({ ...act })}
                        className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition text-sm"
                        title="Edit Activity"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteActivity(act.id, act.clauseNumber, act.activityName)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Delete Activity"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* Inline Notes, Test Measurements & Observations */}
                  <div className="mt-3 pl-8 grid grid-cols-1 md:grid-cols-4 gap-2">
                    <div className="md:col-span-2">
                      <input
                        type="text"
                        value={entry.remarks}
                        onChange={e => {
                          setEntries({
                            ...entries,
                            [act.id]: { ...entry, remarks: e.target.value, isDone: true },
                          });
                        }}
                        placeholder="Notes / Test Observations (e.g. No leakage observed during test)"
                        className="w-full text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        value={entry.testMedium}
                        onChange={e => {
                          setEntries({
                            ...entries,
                            [act.id]: { ...entry, testMedium: e.target.value, isDone: true },
                          });
                        }}
                        placeholder="Medium (e.g. Water / Air)"
                        className="w-full text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        value={entry.testPressure}
                        onChange={e => {
                          setEntries({
                            ...entries,
                            [act.id]: { ...entry, testPressure: e.target.value, isDone: true },
                          });
                        }}
                        placeholder="Pressure (e.g. 59 kg/cm²)"
                        className="w-full text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Photo attachment for this specific activity */}
                  <div className="mt-2.5 pl-8 flex flex-wrap items-center gap-2">
                    <label className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold px-2.5 py-1 rounded-md border border-indigo-200 cursor-pointer flex items-center gap-1 transition">
                      <span>📷</span> Attach Photo
                      <input
                        type="file"
                        accept="image/*"
                        onChange={e => handleUploadPhotoForActivity(act.id, act.clauseNumber, act.activityName, e)}
                        className="hidden"
                      />
                    </label>

                    {(inspection.photos || []).filter((p: any) => p.activityId === act.id).map((p: any) => (
                      <div key={p.id} className="relative group flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-lg p-1 pr-2 text-xs">
                        <img src={`/api/photos/file/${p.id}`} alt={p.caption} className="w-6 h-6 object-cover rounded" />
                        <span className="max-w-[130px] truncate text-slate-700 font-medium">{p.caption}</span>
                        <button
                          type="button"
                          onClick={() => handleDeletePhoto(p.id)}
                          className="text-red-500 hover:text-red-700 font-bold ml-1 text-xs"
                          title="Delete photo"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Edit Activity Modal */}
      {editingActivity && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-8">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>✏️</span> Edit Inspection Activity
              </h3>
              <button onClick={() => setEditingActivity(null)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setSavingActivity(true);
              try {
                await API.updateActivity(editingActivity.id, editingActivity);
                setEditingActivity(null);
                onReload();
              } catch (err: any) {
                alert(err.response?.data?.error || 'Failed to update activity');
              } finally {
                setSavingActivity(false);
              }
            }} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label="ITP Clause Number"
                  value={editingActivity.clauseNumber}
                  onChange={v => setEditingActivity({ ...editingActivity, clauseNumber: v })}
                  placeholder="7.1"
                  required
                />
                <Input
                  label="Activity Name"
                  value={editingActivity.activityName}
                  onChange={v => setEditingActivity({ ...editingActivity, activityName: v })}
                  placeholder="Body mount Leakage test"
                  required
                />
                <div className="md:col-span-2">
                  <Input
                    label="Acceptance Criteria"
                    value={editingActivity.acceptanceCriteria}
                    onChange={v => setEditingActivity({ ...editingActivity, acceptanceCriteria: v })}
                    placeholder="Conform to approved ITP & project specifications"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">TPI Level</label>
                  <select
                    value={editingActivity.interventionTPIA || 'W'}
                    onChange={e => setEditingActivity({ ...editingActivity, interventionTPIA: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-white text-sm"
                  >
                    <option value="H">H - Hold</option>
                    <option value="W">W - Witness</option>
                    <option value="R">R - Review</option>
                    <option value="A">A - Approval</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                  <select
                    value={editingActivity.status || 'ACCEPTABLE'}
                    onChange={e => setEditingActivity({ ...editingActivity, status: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-white text-sm"
                  >
                    <option value="ACCEPTABLE">Acceptable</option>
                    <option value="NOT_ACCEPTABLE">Not Acceptable</option>
                    <option value="ON_HOLD">On Hold</option>
                    <option value="PENDING">Pending</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Input
                    label="Extent of Examination"
                    value={editingActivity.extentOfExam || '100%'}
                    onChange={v => setEditingActivity({ ...editingActivity, extentOfExam: v })}
                    placeholder="100%"
                  />
                </div>
              </div>
              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                <button type="button" onClick={() => setEditingActivity(null)} className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium">Cancel</button>
                <button type="submit" disabled={savingActivity} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm transition disabled:opacity-50">
                  {savingActivity ? 'Saving...' : 'Save Activity'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Tab: Results
function ResultsTab({ inspection, onReload }: any) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    inspectionId: inspection.id, itemId: '', activityId: '', status: 'ACCEPTABLE',
    testMedium: '', testPressure: '', pressureUnit: 'kg/cm²', holdingTimeMin: '', leakageObserved: 'None', remarks: '',
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await API.addResult({ ...form, testPressure: form.testPressure ? parseFloat(form.testPressure) : null, holdingTimeMin: form.holdingTimeMin ? parseFloat(form.holdingTimeMin) : null, confirmedByUser: true });
    setShowForm(false); onReload();
  };

  const handleDeleteResult = async (resultId: string) => {
    if (!confirm('Are you sure you want to delete this result?')) return;
    try {
      await API.deleteResult(resultId);
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete result');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-slate-800">Inspection Results</h3>
        <button onClick={() => setShowForm(!showForm)} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm">+ Enter Result</button>
      </div>
      {showForm && (
        <form onSubmit={handleAdd} className="bg-green-50 p-4 rounded-lg mb-4 space-y-3 border border-green-200">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Item / Valve</label>
              <select value={form.itemId} onChange={e => setForm({ ...form, itemId: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select item...</option>
                {inspection.items?.map((i: any) => <option key={i.id} value={i.id}>{i.tagNumber}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Activity</label>
              <select value={form.activityId} onChange={e => setForm({ ...form, activityId: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select activity...</option>
                {inspection.activities?.map((a: any) => <option key={a.id} value={a.id}>{a.clauseNumber} - {a.activityName}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Result</label>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option value="ACCEPTABLE">✅ Acceptable</option><option value="NOT_ACCEPTABLE">❌ Not Acceptable</option><option value="ON_HOLD">⏸ On Hold</option><option value="NOT_APPLICABLE">N/A</option>
              </select>
            </div>
            <Input label="Test Medium" value={form.testMedium} onChange={v => setForm({ ...form, testMedium: v })} placeholder="Water / Air / Nitrogen" />
            <Input label="Test Pressure" value={form.testPressure} onChange={v => setForm({ ...form, testPressure: v })} placeholder="59" type="number" />
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Pressure Unit</label>
              <select value={form.pressureUnit} onChange={e => setForm({ ...form, pressureUnit: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option>kg/cm²</option><option>bar</option><option>psi</option>
              </select>
            </div>
            <Input label="Holding Time (min)" value={form.holdingTimeMin} onChange={v => setForm({ ...form, holdingTimeMin: v })} placeholder="8" type="number" />
            <Input label="Leakage" value={form.leakageObserved} onChange={v => setForm({ ...form, leakageObserved: v })} placeholder="None" />
            <Input label="Remarks" value={form.remarks} onChange={v => setForm({ ...form, remarks: v })} placeholder="Additional notes" />
          </div>
          <div className="flex gap-2"><button type="submit" className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Confirm & Save Result</button><button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500">Cancel</button></div>
        </form>
      )}
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr><th className="text-left p-2">Tag</th><th className="text-left p-2">Clause</th><th className="text-left p-2">Activity</th><th className="text-left p-2">Result</th><th className="text-left p-2">Pressure</th><th className="text-left p-2">Medium</th><th className="text-left p-2">Hold</th><th className="text-left p-2">Leakage</th><th className="text-right p-2">Action</th></tr></thead>
        <tbody>{inspection.results?.map((r: any) => (
          <tr key={r.id} className="border-t border-slate-100">
            <td className="p-2 font-medium">{r.item?.tagNumber}</td><td className="p-2">{r.activity?.clauseNumber}</td><td className="p-2">{r.activity?.activityName}</td>
            <td className="p-2"><StatusBadge status={r.status} /></td><td className="p-2">{r.testPressure ? `${r.testPressure} ${r.pressureUnit || ''}` : '—'}</td>
            <td className="p-2">{r.testMedium || '—'}</td><td className="p-2">{r.holdingTimeMin ? `${r.holdingTimeMin} min` : '—'}</td><td className="p-2">{r.leakageObserved || '—'}</td>
            <td className="p-2 text-right">
              <button
                onClick={() => handleDeleteResult(r.id)}
                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition text-xs"
                title="Delete Result"
              >
                🗑️
              </button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// Tab: 5.0 Equipment and Instrumentation Used
function InstrumentsTab({ inspection, onReload }: any) {
  const [showForm, setShowForm] = useState(false);
  const [editingInstrument, setEditingInstrument] = useState<any>(null);
  const [form, setForm] = useState({
    inspectionId: inspection.id,
    projectId: inspection.projectId,
    instrumentName: '',
    serialNumber: '',
    certificateNo: '',
    expiryDate: '',
  });
  const [loadingAuto, setLoadingAuto] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await API.addInstrument(form);
      setShowForm(false);
      setForm({
        inspectionId: inspection.id,
        projectId: inspection.projectId,
        instrumentName: '',
        serialNumber: '',
        certificateNo: '',
        expiryDate: '',
      });
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add instrument');
    }
  };

  const handleAutoPopulate = async () => {
    setLoadingAuto(true);
    try {
      await API.autoPopulateInstruments(inspection.id);
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to auto-populate equipment');
    } finally {
      setLoadingAuto(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete instrument "${name}"?`)) return;
    try {
      await API.deleteInstrument(id);
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete instrument');
    }
  };

  const instruments = inspection.instruments || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800 text-lg">5.0 Equipment and Instrumentation Used</h3>
          <p className="text-xs text-slate-500">
            Supplied by Supplier / Vendor. Enter calibrated test gauges, instruments, serial numbers, calibration certs, and expiry dates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAutoPopulate}
            disabled={loadingAuto}
            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-3.5 py-1.5 rounded-lg text-sm font-semibold shadow-sm transition flex items-center gap-1.5"
          >
            <span>⚡</span> {loadingAuto ? 'Loading...' : 'Auto-Load Standard Supplier Equipment'}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-sm font-semibold shadow-sm transition"
          >
            + Add Instrument Manually
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-1">
              <Input
                label="Equipment / Instrument Description"
                value={form.instrumentName}
                onChange={v => setForm({ ...form, instrumentName: v })}
                placeholder="e.g. Pressure Gauge / Stop Watch"
                required
              />
            </div>
            <div>
              <Input
                label="Serial No."
                value={form.serialNumber}
                onChange={v => setForm({ ...form, serialNumber: v })}
                placeholder="e.g. PG7701 / MQC599"
                required
              />
            </div>
            <div>
              <Input
                label="Calibration Cert. No."
                value={form.certificateNo}
                onChange={v => setForm({ ...form, certificateNo: v })}
                placeholder="e.g. SLT/26/02/415/012"
              />
            </div>
            <div>
              <Input
                label="Expiry Date"
                value={form.expiryDate}
                onChange={v => setForm({ ...form, expiryDate: v })}
                type="date"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
              Save Instrument
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500">
              Cancel
            </button>
          </div>
        </form>
      )}

      {instruments.length === 0 ? (
        <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          <p className="text-slate-600 font-medium">No equipment/instruments registered yet.</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            Click <strong>"Auto-Load Standard Supplier Equipment"</strong> to automatically import the standard vendor calibrated test gauges (Pressure Gauge, FE Testing machine, Vernier Caliper, Stop Watch, Measuring Tape), or add equipment manually.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-3 text-left font-bold text-slate-700">Equipment / Instrument Description</th>
                <th className="p-3 text-left font-bold text-slate-700">Serial No.</th>
                <th className="p-3 text-left font-bold text-slate-700">Calibration Cert. No.</th>
                <th className="p-3 text-left font-bold text-slate-700">Expiry Date</th>
                <th className="p-3 text-center font-bold text-slate-700">Status</th>
                <th className="p-3 text-right font-bold text-slate-700">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {instruments.map((inst: any) => {
                let expiryStr = '—';
                let isExpired = false;
                if (inst.expiryDate) {
                  try {
                    const d = new Date(inst.expiryDate);
                    if (!isNaN(d.getTime())) {
                      expiryStr = d.toLocaleDateString('en-GB');
                      isExpired = d.getTime() < Date.now();
                    } else {
                      expiryStr = String(inst.expiryDate);
                    }
                  } catch {
                    expiryStr = String(inst.expiryDate);
                  }
                }
                return (
                  <tr key={inst.id} className="hover:bg-slate-50">
                    <td className="p-3 font-semibold text-slate-800">{inst.instrumentName}</td>
                    <td className="p-3 font-mono text-xs text-slate-600">{inst.serialNumber || '—'}</td>
                    <td className="p-3 font-mono text-xs text-slate-600">{inst.certificateNo || '—'}</td>
                    <td className="p-3 text-slate-700">{expiryStr}</td>
                    <td className="p-3 text-center">
                      {isExpired ? (
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">Expired</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700">Valid</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingInstrument({
                            ...inst,
                            expiryDate: inst.expiryDate ? new Date(inst.expiryDate).toISOString().split('T')[0] : ''
                          })}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                          title="Edit Instrument"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDelete(inst.id, inst.instrumentName)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          title="Delete Instrument"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Instrument Modal */}
      {editingInstrument && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>✏️</span> Edit Equipment / Instrument
              </h3>
              <button onClick={() => setEditingInstrument(null)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await API.updateInstrument(editingInstrument.id, {
                    instrumentName: editingInstrument.instrumentName,
                    serialNumber: editingInstrument.serialNumber,
                    certificateNo: editingInstrument.certificateNo,
                    expiryDate: editingInstrument.expiryDate || null,
                  });
                  setEditingInstrument(null);
                  onReload();
                } catch (err: any) {
                  alert(err.response?.data?.error || 'Failed to update instrument');
                }
              }}
              className="space-y-3"
            >
              <Input
                label="Equipment / Instrument Description"
                value={editingInstrument.instrumentName || ''}
                onChange={v => setEditingInstrument({ ...editingInstrument, instrumentName: v })}
                required
              />
              <Input
                label="Serial No."
                value={editingInstrument.serialNumber || ''}
                onChange={v => setEditingInstrument({ ...editingInstrument, serialNumber: v })}
                required
              />
              <Input
                label="Calibration Cert. No."
                value={editingInstrument.certificateNo || ''}
                onChange={v => setEditingInstrument({ ...editingInstrument, certificateNo: v })}
              />
              <Input
                label="Expiry Date"
                value={editingInstrument.expiryDate || ''}
                onChange={v => setEditingInstrument({ ...editingInstrument, expiryDate: v })}
                type="date"
              />
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingInstrument(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Tab: Attendees
function AttendeesTab({ inspection, onReload }: any) {
  const [showForm, setShowForm] = useState(false);
  const [editingAttendee, setEditingAttendee] = useState<any>(null);
  const [form, setForm] = useState({ inspectionId: inspection.id, name: '', company: '', representedOrg: '', title: '' });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await API.addAttendee(form);
    setShowForm(false); onReload();
  };

  const handleDeleteAttendee = async (attendeeId: string, name: string) => {
    if (!confirm(`Are you sure you want to remove attendee "${name}"?`)) return;
    try {
      await API.deleteAttendee(attendeeId);
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete attendee');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-slate-800">Attendees</h3>
        <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm">+ Add Attendee</button>
      </div>
      {showForm && (
        <form onSubmit={handleAdd} className="bg-slate-50 p-4 rounded-lg mb-4 grid grid-cols-2 gap-3">
          <Input label="Name" value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="Adarsh MS" required />
          <Input label="Company" value={form.company} onChange={v => setForm({ ...form, company: v })} placeholder="Intertek" required />
          <Input label="Represented Org" value={form.representedOrg} onChange={v => setForm({ ...form, representedOrg: v })} placeholder="ADNOC Onshore" required />
          <Input label="Title" value={form.title} onChange={v => setForm({ ...form, title: v })} placeholder="Inspection Engineer" required />
          <div className="col-span-2 flex gap-2"><button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Add</button><button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500">Cancel</button></div>
        </form>
      )}
      <table className="w-full text-sm">
        <thead className="bg-slate-50"><tr><th className="text-left p-2">Name</th><th className="text-left p-2">Company</th><th className="text-left p-2">Represented</th><th className="text-left p-2">Title</th><th className="text-right p-2">Action</th></tr></thead>
        <tbody>{inspection.attendees?.map((a: any) => (
          <tr key={a.id} className="border-t border-slate-100">
            <td className="p-2 font-medium">{a.name}</td>
            <td className="p-2">{a.company}</td>
            <td className="p-2">{a.representedOrg}</td>
            <td className="p-2">{a.title}</td>
            <td className="p-2 text-right">
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => setEditingAttendee({ ...a })}
                  className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition text-xs"
                  title="Edit Attendee"
                >
                  ✏️
                </button>
                <button
                  onClick={() => handleDeleteAttendee(a.id, a.name)}
                  className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition text-xs"
                  title="Delete Attendee"
                >
                  🗑️
                </button>
              </div>
            </td>
          </tr>
        ))}</tbody>
      </table>

      {/* Edit Attendee Modal */}
      {editingAttendee && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>✏️</span> Edit Attendee
              </h3>
              <button onClick={() => setEditingAttendee(null)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await API.updateAttendee(editingAttendee.id, {
                    name: editingAttendee.name,
                    company: editingAttendee.company,
                    representedOrg: editingAttendee.representedOrg,
                    title: editingAttendee.title,
                  });
                  setEditingAttendee(null);
                  onReload();
                } catch (err: any) {
                  alert(err.response?.data?.error || 'Failed to update attendee');
                }
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Name"
                  value={editingAttendee.name || ''}
                  onChange={v => setEditingAttendee({ ...editingAttendee, name: v })}
                  placeholder="e.g. Adarsh MS"
                  required
                />
                <Input
                  label="Company"
                  value={editingAttendee.company || ''}
                  onChange={v => setEditingAttendee({ ...editingAttendee, company: v })}
                  placeholder="e.g. Intertek"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Represented Org"
                  value={editingAttendee.representedOrg || ''}
                  onChange={v => setEditingAttendee({ ...editingAttendee, representedOrg: v })}
                  placeholder="e.g. ADNOC Onshore"
                  required
                />
                <Input
                  label="Title"
                  value={editingAttendee.title || ''}
                  onChange={v => setEditingAttendee({ ...editingAttendee, title: v })}
                  placeholder="e.g. Inspection Engineer"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingAttendee(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Tab: Photos
function PhotosTab({ inspection, onReload }: any) {
  const [uploading, setUploading] = useState(false);
  const categories = ['Name Plate', 'Tag Verification', 'Body', 'Bonnet', 'Actuator', 'Calibration', 'Leak Test', 'FE Test', 'Stroke Test', 'Dimension', 'Painting', 'Other'];
  const [category, setCategory] = useState('Other');
  const [caption, setCaption] = useState('');
  const [itemId, setItemId] = useState('');

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setUploading(true);
    for (const file of Array.from(e.target.files)) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('inspectionId', inspection.id);
      fd.append('category', category);
      fd.append('caption', caption || file.name);
      if (itemId) fd.append('itemId', itemId);
      await API.uploadPhoto(fd);
    }
    setUploading(false); onReload();
    e.target.value = '';
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (!confirm('Are you sure you want to delete this photo?')) return;
    try {
      await API.deletePhoto(photoId);
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete photo');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-slate-800">Inspection Photos</h3>
      </div>
      <div className="bg-slate-50 p-4 rounded-lg mb-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Item</label>
            <select value={itemId} onChange={e => setItemId(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="">All items</option>
              {inspection.items?.map((i: any) => <option key={i.id} value={i.id}>{i.tagNumber}</option>)}
            </select>
          </div>
          <Input label="Caption" value={caption} onChange={setCaption} placeholder="Describe the photo" />
          <div className="flex items-end">
            <label className={`bg-blue-600 text-white px-4 py-2 rounded-lg cursor-pointer font-medium text-sm ${uploading ? 'opacity-50' : 'hover:bg-blue-700'}`}>
              {uploading ? 'Uploading...' : '📸 Upload Photos'}
              <input type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" />
            </label>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {inspection.photos?.map((p: any) => (
          <div key={p.id} className="border border-slate-200 rounded-lg overflow-hidden relative group bg-white shadow-sm">
            <img src={`/api/photos/file/${p.id}`} alt={p.caption} className="w-full h-40 object-cover" />
            <button
              onClick={() => handleDeletePhoto(p.id)}
              className="absolute top-2 right-2 bg-red-600/90 hover:bg-red-700 text-white rounded-full w-7 h-7 flex items-center justify-center text-xs shadow transition opacity-90 group-hover:opacity-100"
              title="Delete Photo"
            >
              🗑️
            </button>
            <div className="p-2.5">
              <p className="text-xs font-medium text-slate-800 truncate">{p.caption}</p>
              <div className="flex justify-between items-center mt-1">
                <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 font-medium">{p.category}</span>
                <button
                  onClick={() => handleDeletePhoto(p.id)}
                  className="text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Tab: Observations
function ObservationsTab({ inspection, onReload }: any) {
  const [showForm, setShowForm] = useState(false);
  const [editingObs, setEditingObs] = useState<any>(null);
  const [form, setForm] = useState({ inspectionId: inspection.id, obsType: 'POSITIVE', criticality: 'NON_CRITICAL', category: 'Documentation', comments: '' });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await API.addObservation(form);
    setShowForm(false); onReload();
  };

  const handleDeleteObservation = async (obsId: string) => {
    if (!confirm('Are you sure you want to delete this observation?')) return;
    try {
      await API.deleteObservation(obsId);
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete observation');
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-slate-800">Quality Observations</h3>
        <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm">+ Add Observation</button>
      </div>
      {showForm && (
        <form onSubmit={handleAdd} className="bg-slate-50 p-4 rounded-lg mb-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
              <select value={form.obsType} onChange={e => setForm({ ...form, obsType: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option value="POSITIVE">Positive</option><option value="NEGATIVE">Negative</option>
              </select>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Criticality</label>
              <select value={form.criticality} onChange={e => setForm({ ...form, criticality: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option value="NON_CRITICAL">Non-Critical</option><option value="CRITICAL">Critical</option>
              </select>
            </div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option>Documentation</option><option>Testing</option><option>Visual</option><option>Dimensional</option><option>Material</option><option>Painting</option>
              </select>
            </div>
          </div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Comments</label>
            <textarea value={form.comments} onChange={e => setForm({ ...form, comments: e.target.value })} className="w-full px-3 py-2 border rounded-lg" rows={3} required /></div>
          <div className="flex gap-2"><button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Add</button><button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500">Cancel</button></div>
        </form>
      )}
      {inspection.observations?.map((o: any) => (
        <div key={o.id} className="p-4 border border-slate-200 rounded-lg mb-2 relative group flex justify-between items-start bg-white shadow-sm">
          <div className="flex-1">
            <div className="flex gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${o.obsType === 'POSITIVE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{o.obsType}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${o.criticality === 'CRITICAL' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{o.criticality}</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{o.category}</span>
            </div>
            <p className="text-sm text-slate-700">{o.comments}</p>
          </div>
          <div className="flex items-center gap-1 ml-3">
            <button
              onClick={() => setEditingObs({ ...o })}
              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition text-sm"
              title="Edit Observation"
            >
              ✏️
            </button>
            <button
              onClick={() => handleDeleteObservation(o.id)}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition text-sm"
              title="Delete Observation"
            >
              🗑️
            </button>
          </div>
        </div>
      ))}

      {/* Edit Observation Modal */}
      {editingObs && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>✏️</span> Edit Quality Observation
              </h3>
              <button onClick={() => setEditingObs(null)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await API.updateObservation(editingObs.id, {
                    obsType: editingObs.obsType,
                    criticality: editingObs.criticality,
                    category: editingObs.category,
                    comments: editingObs.comments,
                  });
                  setEditingObs(null);
                  onReload();
                } catch (err: any) {
                  alert(err.response?.data?.error || 'Failed to update observation');
                }
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                  <select
                    value={editingObs.obsType}
                    onChange={e => setEditingObs({ ...editingObs, obsType: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="POSITIVE">Positive</option>
                    <option value="NEGATIVE">Negative</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Criticality</label>
                  <select
                    value={editingObs.criticality}
                    onChange={e => setEditingObs({ ...editingObs, criticality: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option value="NON_CRITICAL">Non-Critical</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={editingObs.category}
                    onChange={e => setEditingObs({ ...editingObs, category: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  >
                    <option>Documentation</option>
                    <option>Testing</option>
                    <option>Visual</option>
                    <option>Dimensional</option>
                    <option>Material</option>
                    <option>Painting</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Comments</label>
                <textarea
                  value={editingObs.comments || ''}
                  onChange={e => setEditingObs({ ...editingObs, comments: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  rows={3}
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingObs(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Tab: Report Generation
function ReportTab({ inspection, onReload }: any) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [reportType, setReportType] = useState<'IR' | 'FR'>(inspection.reportFormatType === 'FR' ? 'FR' : 'IR');
  const [selectedTemplate, setSelectedTemplate] = useState(inspection.selectedTemplate || 'master-template.docx');
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  useEffect(() => {
    API.getTemplates().then(r => {
      setTemplates(r.data);
      const currentType: 'IR' | 'FR' = inspection.reportFormatType === 'FR' ? 'FR' : 'IR';
      setReportType(currentType);

      const filtered = r.data.filter((t: any) => (t.type || 'IR') === currentType);
      const initialTemplate = inspection.selectedTemplate;
      if (initialTemplate && filtered.some((t: any) => t.name === initialTemplate)) {
        setSelectedTemplate(initialTemplate);
      } else if (filtered.length > 0) {
        setSelectedTemplate(filtered[0].name);
        API.updateInspection(inspection.id, { selectedTemplate: filtered[0].name }).catch(() => {});
      }
    }).catch(() => {});
  }, [inspection.id, inspection.reportFormatType, inspection.selectedTemplate]);

  const handleTypeChange = async (newType: 'IR' | 'FR') => {
    setReportType(newType);
    const filtered = templates.filter((t: any) => (t.type || 'IR') === newType);
    const newSelected = filtered.length > 0 ? filtered[0].name : '';
    if (newSelected) {
      setSelectedTemplate(newSelected);
    }
    try {
      await API.updateInspection(inspection.id, {
        reportFormatType: newType,
        ...(newSelected ? { selectedTemplate: newSelected } : {})
      });
      if (onReload) onReload();
    } catch (err: any) {
      console.error('Failed to update inspection report format type:', err);
    }
  };

  const handleTemplateSelect = async (tmplName: string) => {
    setSelectedTemplate(tmplName);
    try {
      await API.updateInspection(inspection.id, { selectedTemplate: tmplName });
      if (onReload) onReload();
    } catch (err: any) {
      console.error('Failed to save selected template:', err);
    }
  };

  const handleToggleTemplateCategory = async (tmplName: string, currentCategory: string) => {
    const targetCategory = currentCategory === 'FR' ? 'IR' : 'FR';
    try {
      await API.updateTemplateCategory(tmplName, targetCategory);
      const res = await API.getTemplates();
      setTemplates(res.data);
      if (onReload) onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update template category');
    }
  };

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    if (!file.name.endsWith('.docx')) {
      alert('Please upload a valid .docx format template');
      return;
    }
    setUploadingTemplate(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('formatType', reportType);
    try {
      await API.uploadTemplate(fd);
      const res = await API.getTemplates();
      setTemplates(res.data);
      setSelectedTemplate(file.name);
      await API.updateInspection(inspection.id, { selectedTemplate: file.name, reportFormatType: reportType });
      if (onReload) onReload();
      alert(`Format template "${file.name}" uploaded successfully into ${reportType} category!`);
    } catch {
      alert('Failed to upload template format');
    }
    setUploadingTemplate(false);
    e.target.value = '';
  };

  const attendedActivities = (inspection.activities || []).filter((act: any) => {
    const result = inspection.results?.find((r: any) => r.activityId === act.id);
    return act.status === 'ACCEPTABLE' || act.status === 'NOT_ACCEPTABLE' || (result && result.status !== 'PENDING');
  });
  const offeredItems = (inspection.items || []).filter((i: any) => i.presentedQty > 0 || i.presentedQty === undefined);
  const photosCount = inspection.photos?.length || 0;

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const r = await API.generateReport(inspection.id, selectedTemplate);
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportType}_Report_${inspection.reportNumber || 'draft'}.docx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error('Report generation error:', e);
      let errMsg = 'Report generation failed. Check that all required data is present.';
      if (e.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text();
          const parsed = JSON.parse(text);
          if (parsed.error) errMsg = `Server Error: ${parsed.error}`;
        } catch {
          // not json
        }
      } else if (e.response?.data?.error) {
        errMsg = `Server Error: ${e.response.data.error}`;
      } else if (e.message) {
        errMsg = `Error: ${e.message}`;
      }
      setError(errMsg);
    }
    setGenerating(false);
  };

  const handleDeleteTemplate = async (templateName: string) => {
    if (!confirm(`Are you sure you want to delete template format "${templateName}"?`)) return;
    try {
      await API.deleteTemplate(templateName);
      const res = await API.getTemplates();
      setTemplates(res.data);
      const remainingFiltered = res.data.filter((t: any) => (t.type || 'IR') === reportType);
      if (remainingFiltered.length > 0) {
        handleTemplateSelect(remainingFiltered[0].name);
      }
      alert('Template format deleted successfully');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete template');
    }
  };

  const irTemplatesCount = templates.filter((t: any) => (t.type || 'IR') === 'IR').length;
  const frTemplatesCount = templates.filter((t: any) => t.type === 'FR').length;
  const filteredTemplates = templates.filter((t: any) => (t.type || 'IR') === reportType);
  const currentTmplObj = templates.find((t: any) => t.name === selectedTemplate);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-800 text-lg">Report Generation & Format Customization</h3>
          <p className="text-xs text-slate-500">Choose between Inspection Report (IR) or Final Report (FR), select matching templates, and export.</p>
        </div>
      </div>
      
      {/* Template Format Selector & Uploader */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
        {/* IR vs FR Category Selection Bar */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            1. Select Report Type (Saved with this Inspection)
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
            <button
              type="button"
              onClick={() => handleTypeChange('IR')}
              className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between ${
                reportType === 'IR'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md ring-2 ring-blue-300'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">📄</span>
                <div>
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    <span>IR</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold uppercase tracking-wider ${
                      reportType === 'IR' ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600'
                    }`}>
                      Inspection Report
                    </span>
                  </div>
                  <p className={`text-xs mt-0.5 ${reportType === 'IR' ? 'text-blue-100' : 'text-slate-400'}`}>
                    Witness & hold point stages
                  </p>
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                reportType === 'IR' ? 'bg-white text-blue-700' : 'bg-slate-100 text-slate-600'
              }`}>
                {irTemplatesCount} formats
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleTypeChange('FR')}
              className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between ${
                reportType === 'FR'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-md ring-2 ring-indigo-300'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">📑</span>
                <div>
                  <div className="font-bold text-sm flex items-center gap-1.5">
                    <span>FR</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold uppercase tracking-wider ${
                      reportType === 'FR' ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600'
                    }`}>
                      Final Report
                    </span>
                  </div>
                  <p className={`text-xs mt-0.5 ${reportType === 'FR' ? 'text-indigo-100' : 'text-slate-400'}`}>
                    Final Factory Acceptance / Release
                  </p>
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                reportType === 'FR' ? 'bg-white text-indigo-700' : 'bg-slate-100 text-slate-600'
              }`}>
                {frTemplatesCount} formats
              </span>
            </button>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h4 className="font-semibold text-slate-800 flex items-center gap-2">
                <span>📋</span> 2. Choose Matching {reportType} Template Format
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Showing existing formats classified for <strong>{reportType === 'IR' ? 'Inspection Report (IR)' : 'Final Report (FR)'}</strong>.
              </p>
            </div>
            
            <label className={`inline-flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-3.5 py-1.5 rounded-lg font-medium text-xs hover:bg-slate-100 cursor-pointer shadow-sm ${uploadingTemplate ? 'opacity-50' : ''}`}>
              <span>📤</span> {uploadingTemplate ? 'Uploading...' : `Upload New ${reportType} Format (.docx)`}
              <input type="file" accept=".docx" onChange={handleTemplateUpload} className="hidden" />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Active Template Format ({reportType})
              </label>
              {filteredTemplates.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  No {reportType} formats found. Please upload a {reportType} document format using the button above.
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    value={selectedTemplate}
                    onChange={e => handleTemplateSelect(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {filteredTemplates.map(t => (
                      <option key={t.name} value={t.name}>
                        {t.displayName || t.name} ({(t.size ? t.size / 1024 / 1024 : 0.05).toFixed(2)} MB)
                      </option>
                    ))}
                  </select>
                  {selectedTemplate !== 'master-template.docx' && (
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(selectedTemplate)}
                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition shrink-0"
                      title="Delete this template format"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-xs text-blue-900 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-slate-700">Selected Format Details:</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    reportType === 'IR' ? 'bg-blue-100 text-blue-700' : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    {reportType}
                  </span>
                </div>
                <p className="truncate font-mono text-slate-800 font-medium">{selectedTemplate}</p>
                <p className="text-slate-500 mt-1">
                  {currentTmplObj?.description || 'Word DOCX template file with exact headers, footers and tables.'}
                </p>
              </div>

              {currentTmplObj && (
                <div className="pt-2 border-t border-blue-200/50 flex items-center justify-between mt-2">
                  <span className="text-[11px] text-slate-500">Wrong classification?</span>
                  <button
                    type="button"
                    onClick={() => handleToggleTemplateCategory(selectedTemplate, reportType)}
                    className="text-[11px] text-blue-700 hover:underline font-semibold"
                  >
                    Move to {reportType === 'IR' ? 'FR' : 'IR'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Clean Template Assurance & Preview */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-950 space-y-1.5 shadow-sm">
        <h5 className="font-bold text-sm text-emerald-900 flex items-center gap-2">
          <span>✨</span> Smart Report Sanitization Active
        </h5>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
          <div className="bg-white p-2.5 rounded-lg border border-emerald-200">
            <span className="font-bold text-slate-800 text-sm block">{attendedActivities.length} Attended Activities</span>
            <span className="text-slate-500">Only these are included in Table 9. Unattended clauses are omitted.</span>
          </div>
          <div className="bg-white p-2.5 rounded-lg border border-emerald-200">
            <span className="font-bold text-slate-800 text-sm block">{offeredItems.length} Offered Valves</span>
            <span className="text-slate-500">Materials selected as offered for this visit will be in Table 7.</span>
          </div>
          <div className="bg-white p-2.5 rounded-lg border border-emerald-200">
            <span className="font-bold text-slate-800 text-sm block">{photosCount} Uploaded Photos</span>
            <span className="text-slate-500">{photosCount === 0 ? 'Empty photo notice (old sample photos wiped).' : 'Only your uploaded photos will appear.'}</span>
          </div>
        </div>
      </div>

      {/* Generation Action Box */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-xl p-6 shadow-md">
        <h4 className="font-bold text-lg mb-2 flex items-center gap-2">
          <span>⚡</span> Generate Official Inspection Report
        </h4>
        <p className="text-blue-100 text-sm mb-5 max-w-2xl">
          Instantly synthesizes all inspection metadata, items inspected, scope activities, test results, calibration logs, attendees, and attached photo grids directly into the chosen DOCX format.
        </p>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="bg-white text-blue-700 hover:bg-blue-50 px-6 py-2.5 rounded-lg font-bold shadow-md transition disabled:opacity-50 text-sm flex items-center gap-2"
        >
          {generating ? '⏳ Populating Template...' : '📥 Generate & Download (.docx)'}
        </button>
        {error && <p className="text-red-200 bg-red-900/40 border border-red-400/40 rounded-lg p-3 text-sm mt-4">{error}</p>}
      </div>

      {/* Review Checklist */}
      <div>
        <h4 className="font-semibold text-slate-800 mb-3">Pre-Generation Quality Checklist</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <CheckItem label="Items / Equipment Added" ok={(inspection.items?.length || 0) > 0} />
          <CheckItem label="Activities Defined" ok={(inspection.activities?.length || 0) > 0} />
          <CheckItem label="Results Recorded" ok={(inspection.results?.length || 0) > 0} />
          <CheckItem label="Attendees Listed" ok={(inspection.attendees?.length || 0) > 0} />
          <CheckItem label="Photos Uploaded" ok={(inspection.photos?.length || 0) > 0} />
        </div>
      </div>
    </div>
  );
}

function CheckItem({ label, ok }: { label: string; ok: boolean }) {
  return <div className={`p-3 rounded-lg border text-sm ${ok ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{ok ? '✅' : '❌'} {label}</div>;
}

// ============================================================
// Documents & Photos List Pages
// ============================================================
function DocumentsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  useEffect(() => { API.getProjects().then(r => setProjects(r.data)); }, []);
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Documents</h1>
      <p className="text-slate-500 mb-4">Select a project to view and upload documents.</p>
      <div className="grid gap-4">
        {projects.map((p: any) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="bg-white rounded-xl border border-slate-200 p-6 hover:border-blue-300 block">
            <h3 className="font-semibold">{p.projectNumber}</h3><p className="text-sm text-slate-500">{p.projectName}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PhotosPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Photos</h1>
      <p className="text-slate-500">Photos are managed within each inspection workspace. Navigate to an inspection to upload and manage photos.</p>
    </div>
  );
}

function InspectionsPage({ currentUser }: { currentUser?: any }) {
  const [inspections, setInspections] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [selectedInspectorId, setSelectedInspectorId] = useState<string>('');
  const canFilter = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  const load = () => {
    API.getInspections(undefined, selectedInspectorId || undefined)
      .then(r => setInspections(r.data))
      .catch(() => {});
  };

  useEffect(() => {
    if (canFilter) {
      API.getUsers().then(r => setTeamMembers(r.data)).catch(() => {});
    }
  }, [canFilter]);

  useEffect(() => {
    load();
  }, [selectedInspectorId]);

  const handleDeleteInspection = async (e: React.MouseEvent, inspId: string, reportNo: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete inspection ${reportNo}? All items, results, photos, and report data will be deleted.`)) return;
    try {
      await API.deleteInspection(inspId);
      load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete inspection');
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Inspections</h1>
          <p className="text-sm text-slate-500 mt-1">
            {currentUser?.role === 'ADMIN' && 'Showing company-wide inspections across all teams.'}
            {currentUser?.role === 'MANAGER' && 'Showing inspections for your team and subordinates.'}
            {currentUser?.role === 'INSPECTOR' && 'Showing inspections assigned to you.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canFilter && teamMembers.length > 0 && (
            <select
              value={selectedInspectorId}
              onChange={e => setSelectedInspectorId(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-medium text-slate-700"
            >
              <option value="">All Team Members ({teamMembers.length})</option>
              {teamMembers.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.fullName} ({m.role === 'INSPECTOR' ? 'Field Staff' : m.role})
                </option>
              ))}
            </select>
          )}
          <Link to="/inspections/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium whitespace-nowrap">+ New Inspection</Link>
        </div>
      </div>
      <div className="space-y-3">
        {inspections.map((insp: any) => (
          <div key={insp.id} className="flex items-center justify-between bg-white p-5 rounded-xl border border-slate-200 hover:border-blue-300 transition">
            <Link to={`/inspections/${insp.id}`} className="flex-1 block">
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-semibold text-slate-800 hover:text-blue-600">{insp.reportNumber}</span>
                  <span className="ml-2 text-sm text-slate-500">{insp.project?.projectNumber}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm text-slate-500">{insp.inspectionType} — {insp.location} — {new Date(insp.startDate).toLocaleDateString()}</p>
                    {insp.inspector && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                        👤 {insp.inspector.fullName}
                      </span>
                    )}
                  </div>
                </div>
                <StatusBadge status={insp.status} />
              </div>
            </Link>
            <button
              onClick={(e) => handleDeleteInspection(e, insp.id, insp.reportNumber)}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition ml-3"
              title="Delete Inspection"
            >
              🗑️
            </button>
          </div>
        ))}
        {inspections.length === 0 && <p className="text-slate-500 text-center py-12">No inspections yet.</p>}
      </div>
    </div>
  );
}

// ============================================================
// Shared Input Component
// ============================================================
function Input({ label, value, onChange, placeholder, type, required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        required={required} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
    </div>
  );
}

// ============================================================
// Main App
// ============================================================
export default function App() {
  const { user, loading, login, logout } = useAuth();

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><p className="text-slate-500">Loading...</p></div>;
  if (!user) return <LoginPage onLogin={login} />;

  return (
    <BrowserRouter>
      <Layout user={user} onLogout={logout}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage currentUser={user} />} />
          <Route path="/projects/:id" element={<ProjectDetailPage currentUser={user} />} />
          <Route path="/inspections" element={<InspectionsPage currentUser={user} />} />
          <Route path="/inspections/new" element={<NewInspectionPage currentUser={user} />} />
          <Route path="/inspections/:id" element={<InspectionWorkspacePage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/photos" element={<PhotosPage />} />
          <Route path="/admin" element={<AdminPage currentUser={user} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
