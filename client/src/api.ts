import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// Auth
export const login = (email: string, password: string) =>
  api.post('/auth/login', { email, password });
export const register = (data: any) => api.post('/auth/register', data);
export const getMe = () => api.get('/auth/me');

// Projects
export const getProjects = () => api.get('/projects');
export const createProject = (data: any) => api.post('/projects', data);
export const getProject = (id: string) => api.get(`/projects/${id}`);
export const deleteProject = (id: string) => api.delete(`/projects/${id}`);

// Documents
export const uploadDocument = (formData: FormData) =>
  api.post('/documents/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const getDocuments = (projectId: string) =>
  api.get('/documents', { params: { projectId } });
export const getDocument = (id: string) => api.get(`/documents/${id}`);
export const processDocument = (id: string) => api.post(`/documents/${id}/process`);
export const deleteDocument = (id: string) => api.delete(`/documents/${id}`);

// Inspections
export const getInspections = (projectId?: string) =>
  api.get('/inspections', { params: { projectId } });
export const createInspection = (data: any) => api.post('/inspections', data);
export const getInspection = (id: string) => api.get(`/inspections/${id}`);
export const updateInspection = (id: string, data: any) => api.put(`/inspections/${id}`, data);
export const deleteInspection = (id: string) => api.delete(`/inspections/${id}`);
export const importRFI = (inspectionId: string, documentId: string) =>
  api.post(`/inspections/${inspectionId}/import-rfi`, { documentId });
export const saveDailyChecklist = (inspectionId: string, entries: any[]) =>
  api.post(`/inspections/${inspectionId}/daily-checklist`, { entries });

// Items
export const addItem = (data: any) => api.post('/inspections/items', data);
export const updateItem = (id: string, data: any) => api.put(`/inspections/items/${id}`, data);
export const deleteItem = (id: string) => api.delete(`/inspections/items/${id}`);

// Activities
export const addActivity = (data: any) => api.post('/inspections/activities', data);
export const updateActivity = (id: string, data: any) => api.put(`/inspections/activities/${id}`, data);
export const deleteActivity = (id: string) => api.delete(`/inspections/activities/${id}`);

// Results
export const addResult = (data: any) => api.post('/results', data);
export const updateResult = (id: string, data: any) => api.put(`/results/${id}`, data);
export const deleteResult = (id: string) => api.delete(`/results/${id}`);

// Photos
export const uploadPhoto = (formData: FormData) =>
  api.post('/photos/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const getPhotos = (inspectionId: string) =>
  api.get('/photos', { params: { inspectionId } });
export const deletePhoto = (id: string) => api.delete(`/photos/${id}`);

// Attendees
export const addAttendee = (data: any) => api.post('/inspections/attendees', data);
export const deleteAttendee = (id: string) => api.delete(`/inspections/attendees/${id}`);

// Observations
export const addObservation = (data: any) => api.post('/inspections/observations', data);
export const deleteObservation = (id: string) => api.delete(`/inspections/observations/${id}`);

// Instruments & Calibration (Section 5.0)
export const addInstrument = (data: any) => api.post('/instruments', data);
export const getInstruments = (inspectionId?: string, projectId?: string) =>
  api.get('/instruments', { params: { inspectionId, projectId } });
export const updateInstrument = (id: string, data: any) => api.put(`/instruments/${id}`, data);
export const deleteInstrument = (id: string) => api.delete(`/instruments/${id}`);
export const autoPopulateInstruments = (inspectionId: string) =>
  api.post(`/inspections/${inspectionId}/auto-instruments`);
export const addCalibrationCert = (data: any) => api.post('/instruments/calibration', data);

// Validation
export const validateInspection = (inspectionId: string) =>
  api.get(`/validation/${inspectionId}`);

// Reports
export const generateReport = (inspectionId: string, templateName?: string) =>
  api.post(`/reports/generate/${inspectionId}`, { templateName }, { responseType: 'blob' });
export const getTemplates = () => api.get('/reports/templates');
export const uploadTemplate = (formData: FormData) =>
  api.post('/reports/templates/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const deleteTemplate = (name: string) => api.delete(`/reports/templates/${name}`);
