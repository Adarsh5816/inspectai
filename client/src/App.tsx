import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import * as API from './api';

// ============================================================
// Auth Context
// ============================================================
function useAuth() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      API.getMe().then(r => setUser(r.data.user)).catch(() => localStorage.removeItem('token')).finally(() => setLoading(false));
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
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm">
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
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500">{user?.fullName}</span>
          <button onClick={onLogout} className="text-sm text-red-600 hover:text-red-800">Logout</button>
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
function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ projectNumber: '', projectName: '', customerName: '', supplierName: '', poNumber: '' });

  const load = () => API.getProjects().then(r => setProjects(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await API.createProject(form);
    setShowForm(false); setForm({ projectNumber: '', projectName: '', customerName: '', supplierName: '', poNumber: '' });
    load();
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
        <h1 className="text-2xl font-bold text-slate-800">Projects</h1>
        <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium">+ New Project</button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-slate-200 p-6 mb-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Project Number" value={form.projectNumber} onChange={v => setForm({ ...form, projectNumber: v })} placeholder="P30339B" />
            <Input label="Project Name" value={form.projectName} onChange={v => setForm({ ...form, projectName: v })} placeholder="EPC for SE AiP5 Project..." />
            <Input label="Customer" value={form.customerName} onChange={v => setForm({ ...form, customerName: v })} placeholder="ADNOC Onshore" />
            <Input label="Supplier" value={form.supplierName} onChange={v => setForm({ ...form, supplierName: v })} placeholder="KSB MIL Controls Limited" />
            <Input label="PO Number" value={form.poNumber} onChange={v => setForm({ ...form, poNumber: v })} placeholder="04108-PM-INST-008" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Create Project</button>
            <button type="button" onClick={() => setShowForm(false)} className="text-slate-600 px-4 py-2">Cancel</button>
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
function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    API.getProject(id).then(r => setProject(r.data));
    API.getDocuments(id).then(r => setDocuments(r.data)).catch(() => {});
    API.getInspections(id).then(r => setInspections(r.data)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0] || !id) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', e.target.files[0]);
    fd.append('projectId', id);
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
        <h2 className="font-semibold text-slate-800 mb-3">Project Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-slate-500">Name:</span> <span className="font-medium">{project.projectName}</span></div>
          <div><span className="text-slate-500">Customer:</span> <span className="font-medium">{project.customerName}</span></div>
          <div><span className="text-slate-500">Supplier:</span> <span className="font-medium">{project.supplierName}</span></div>
          <div><span className="text-slate-500">PO:</span> <span className="font-medium">{project.poNumber}</span></div>
        </div>
      </div>

      {/* Documents Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold text-slate-800">Documents (RFI, ITP, Calibration, etc.)</h2>
          <label className={`bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 cursor-pointer font-medium ${uploading ? 'opacity-50' : ''}`}>
            {uploading ? 'Uploading...' : '📤 Upload Document'}
            <input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
          </label>
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
    </div>
  );
}

// ============================================================
// New Inspection Page
// ============================================================
function NewInspectionPage() {
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(window.location.search);
  const projectId = searchParams.get('projectId') || '';
  const [projects, setProjects] = useState<any[]>([]);
  const [form, setForm] = useState({
    projectId, reportNumber: '', inspectionType: 'FAT', location: '', startDate: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => { API.getProjects().then(r => setProjects(r.data)); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await API.createInspection(form);
      navigate(`/inspections/${r.data.id}`);
    } catch { alert('Failed to create inspection'); }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">New Inspection</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Project</label>
          <select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} className="w-full px-3 py-2 border rounded-lg" required>
            <option value="">Select project...</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.projectNumber} — {p.projectName}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Report Number" value={form.reportNumber} onChange={v => setForm({ ...form, reportNumber: v })} placeholder="001" required />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Inspection Type</label>
            <select value={form.inspectionType} onChange={e => setForm({ ...form, inspectionType: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
              <option>FAT</option><option>Stage Inspection</option><option>Final Inspection</option><option>Pre-Inspection Meeting</option>
            </select>
          </div>
          <Input label="Location" value={form.location} onChange={v => setForm({ ...form, location: v })} placeholder="Meladoor, Kerala" required />
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

  const load = useCallback(() => {
    if (!id) return;
    API.getInspection(id).then(r => setInspection(r.data)).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);

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

      {/* Progress bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div><span className="text-slate-500">Project:</span> <span className="font-medium">{inspection.project?.projectNumber}</span></div>
          <div><span className="text-slate-500">Type:</span> <span className="font-medium">{inspection.inspectionType}</span></div>
          <div><span className="text-slate-500">Date:</span> <span className="font-medium">{new Date(inspection.startDate).toLocaleDateString()}</span></div>
          <div><span className="text-slate-500">Location:</span> <span className="font-medium">{inspection.location}</span></div>
          <div><span className="text-slate-500">Supplier:</span> <span className="font-medium">{inspection.project?.supplierName}</span></div>
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
        }} validation={validation} />}
        {activeTab === 'items' && <ItemsTab inspection={inspection} onReload={load} />}
        {activeTab === 'activities' && <ActivitiesTab inspection={inspection} onReload={load} />}
        {activeTab === 'results' && <ResultsTab inspection={inspection} onReload={load} />}
        {activeTab === 'instruments' && <InstrumentsTab inspection={inspection} onReload={load} />}
        {activeTab === 'attendees' && <AttendeesTab inspection={inspection} onReload={load} />}
        {activeTab === 'photos' && <PhotosTab inspection={inspection} onReload={load} />}
        {activeTab === 'observations' && <ObservationsTab inspection={inspection} onReload={load} />}
        {activeTab === 'report' && <ReportTab inspection={inspection} />}
      </div>
    </div>
  );
}

// Tab: Overview
function OverviewTab({ inspection, onValidate, validation }: any) {
  const totalAct = inspection.activities?.length || 0;
  const doneAct = inspection.activities?.filter((a: any) => a.status === 'ACCEPTABLE' || a.status === 'NOT_ACCEPTABLE').length || 0;
  const pct = totalAct > 0 ? Math.round((doneAct / totalAct) * 100) : 0;

  return (
    <div className="space-y-6">
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
function ItemsTab({ inspection, onReload }: any) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ inspectionId: inspection.id, poItemNo: '', tagNumber: '', serialNumber: '', jobNo: '', itemName: 'Control Valve', sizeInch: '', rating: '', bodyMaterial: '' });

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

  const handleDeleteItem = async (itemId: string, tag: string) => {
    if (!confirm(`Are you sure you want to delete valve/equipment "${tag}"?`)) return;
    try {
      await API.deleteItem(itemId);
      onReload();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete item');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800 text-lg">Offered Equipment &amp; Materials List</h3>
          <p className="text-xs text-slate-500">
            Select which materials/valves are offered for this specific inspection visit. Only offered materials are populated into the inspection report.
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-sm font-semibold shadow-sm transition">
          + Add Material Manually
        </button>
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

      {(!inspection.items || inspection.items.length === 0) ? (
        <p className="text-slate-500 text-sm py-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
          No materials loaded yet. Import an RFI to automatically extract and list all valves.
        </p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
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
              {inspection.items.map((item: any) => {
                const isOffered = item.presentedQty > 0 || item.presentedQty === undefined;
                return (
                  <tr key={item.id} className={isOffered ? 'bg-blue-50/20' : 'bg-slate-50/50 opacity-60'}>
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
                    <td className="p-3 text-right">
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
    </div>
  );
}

// Tab: Activities & Daily Checklist
function ActivitiesTab({ inspection, onReload }: any) {
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState({ inspectionId: inspection.id, clauseNumber: '', activityName: '', acceptanceCriteria: '', interventionTPIA: 'W' });
  const [showRfiModal, setShowRfiModal] = useState(false);
  const [rfiDocs, setRfiDocs] = useState<any[]>([]);
  const [uploadingRfi, setUploadingRfi] = useState(false);
  const [importingRfi, setImportingRfi] = useState(false);
  const [selectedDate, setSelectedDate] = useState(inspection.startDate ? new Date(inspection.startDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [savingDaily, setSavingDaily] = useState(false);
  
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

  // Sync entries from inspection activities and results
  useEffect(() => {
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

  const loadRfiDocuments = async () => {
    try {
      const res = await API.getDocuments(inspection.projectId);
      setRfiDocs(res.data.filter((d: any) => d.documentType === 'RFI' || d.originalFilename.toLowerCase().includes('rfi')));
      setShowRfiModal(true);
    } catch {
      alert('Failed to load project documents');
    }
  };

  const handleImportRfi = async (docId: string) => {
    setImportingRfi(true);
    try {
      const res = await API.importRFI(inspection.id, docId);
      alert(res.data.message || 'Successfully imported activities and items from RFI!');
      setShowRfiModal(false);
      onReload();
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
    try {
      const uploadRes = await API.uploadDocument(fd);
      await handleImportRfi(uploadRes.data.id);
    } catch {
      alert('Failed to upload RFI');
    }
    setUploadingRfi(false);
    e.target.value = '';
  };

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

  const activities = inspection.activities || [];
  const completedCount = Object.values(entries).filter(e => e.isDone).length;

  return (
    <div className="space-y-6">
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
              onClick={loadRfiDocuments}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 rounded-lg font-medium text-sm flex items-center gap-1.5 shadow-sm transition"
            >
              <span>📥</span> Import Activities from RFI
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
            onClick={loadRfiDocuments}
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

      {/* RFI Import Modal */}
      {showRfiModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <span>📥</span> Select RFI Document
              </h3>
              <button onClick={() => setShowRfiModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <p className="text-sm text-slate-600">
              Select an uploaded RFI document from the project, or upload a new RFI PDF to automatically extract and populate all activities and valves.
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {rfiDocs.length === 0 ? (
                <p className="text-sm text-slate-500 py-3 text-center">No RFI documents found in this project.</p>
              ) : (
                rfiDocs.map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-xl hover:bg-slate-50">
                    <div>
                      <p className="font-semibold text-sm text-slate-800">{doc.originalFilename}</p>
                      <p className="text-xs text-slate-500">{doc.documentType} • {(doc.fileSizeBytes / 1024).toFixed(0)} KB</p>
                    </div>
                    <button
                      onClick={() => handleImportRfi(doc.id)}
                      disabled={importingRfi}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50"
                    >
                      {importingRfi ? 'Importing...' : 'Import Activities'}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <label className={`bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition ${uploadingRfi ? 'opacity-50' : ''}`}>
                {uploadingRfi ? 'Uploading...' : '📤 Upload New RFI (.pdf, .docx, .doc, .xlsx, .csv)'}
                <input type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv" onChange={handleUploadAndImportRfi} className="hidden" />
              </label>
              <button onClick={() => setShowRfiModal(false)} className="text-slate-500 hover:text-slate-700 text-sm font-medium">Cancel</button>
            </div>
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
                      <button
                        onClick={() => handleDelete(inst.id, inst.instrumentName)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        title="Delete Instrument"
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
    </div>
  );
}

// Tab: Attendees
function AttendeesTab({ inspection, onReload }: any) {
  const [showForm, setShowForm] = useState(false);
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
              <button
                onClick={() => handleDeleteAttendee(a.id, a.name)}
                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition text-xs"
                title="Delete Attendee"
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
          <button
            onClick={() => handleDeleteObservation(o.id)}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition text-sm ml-3"
            title="Delete Observation"
          >
            🗑️
          </button>
        </div>
      ))}
    </div>
  );
}

// Tab: Report Generation
function ReportTab({ inspection }: any) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('master-template.docx');
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  useEffect(() => {
    API.getTemplates().then(r => {
      setTemplates(r.data);
      if (r.data.length > 0 && !r.data.some((t: any) => t.name === selectedTemplate)) {
        setSelectedTemplate(r.data[0].name);
      }
    }).catch(() => {});
  }, []);

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
    try {
      await API.uploadTemplate(fd);
      const res = await API.getTemplates();
      setTemplates(res.data);
      setSelectedTemplate(file.name);
      alert(`Format template "${file.name}" uploaded successfully!`);
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
      a.download = `Inspection_Report_${inspection.reportNumber || 'draft'}.docx`;
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
      if (res.data.length > 0) setSelectedTemplate(res.data[0].name);
      alert('Template format deleted successfully');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete template');
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="font-semibold text-slate-800 text-lg">Report Generation & Format Customization</h3>
      
      {/* Template Format Selector & Uploader */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h4 className="font-semibold text-slate-800 flex items-center gap-2">
              <span>📋</span> Active Report Template Format
            </h4>
            <p className="text-sm text-slate-500 mt-0.5">
              Select or upload the inspection report format required by the company or client.
            </p>
          </div>
          
          <label className={`inline-flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg font-medium text-sm hover:bg-slate-100 cursor-pointer shadow-sm ${uploadingTemplate ? 'opacity-50' : ''}`}>
            <span>📤</span> {uploadingTemplate ? 'Uploading...' : 'Upload New Company Format (.docx)'}
            <input type="file" accept=".docx" onChange={handleTemplateUpload} className="hidden" />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Choose Template Format
            </label>
            <div className="flex items-center gap-2">
              <select
                value={selectedTemplate}
                onChange={e => setSelectedTemplate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {templates.map(t => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({(t.size / 1024 / 1024).toFixed(2)} MB)
                  </option>
                ))}
              </select>
              {selectedTemplate !== 'master-template.docx' && (
                <button
                  type="button"
                  onClick={() => handleDeleteTemplate(selectedTemplate)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                  title="Delete this template format"
                >
                  🗑️
                </button>
              )}
            </div>
          </div>
          <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 flex flex-col justify-center">
            <span className="font-semibold">Selected Format:</span>
            <span className="truncate font-mono">{selectedTemplate}</span>
            <span className="text-slate-500 mt-0.5">Report engine will populate this exact layout preserving all styling, headers, footers & tables.</span>
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

function InspectionsPage() {
  const [inspections, setInspections] = useState<any[]>([]);
  const load = () => API.getInspections().then(r => setInspections(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

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
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Inspections</h1>
        <Link to="/inspections/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium">+ New Inspection</Link>
      </div>
      <div className="space-y-3">
        {inspections.map((insp: any) => (
          <div key={insp.id} className="flex items-center justify-between bg-white p-5 rounded-xl border border-slate-200 hover:border-blue-300 transition">
            <Link to={`/inspections/${insp.id}`} className="flex-1 block">
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-semibold text-slate-800 hover:text-blue-600">{insp.reportNumber}</span>
                  <span className="ml-2 text-sm text-slate-500">{insp.project?.projectNumber}</span>
                  <p className="text-sm text-slate-500 mt-1">{insp.inspectionType} — {insp.location} — {new Date(insp.startDate).toLocaleDateString()}</p>
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
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/inspections" element={<InspectionsPage />} />
          <Route path="/inspections/new" element={<NewInspectionPage />} />
          <Route path="/inspections/:id" element={<InspectionWorkspacePage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/photos" element={<PhotosPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
