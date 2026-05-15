import { Navigate, Route, Routes } from 'react-router-dom';
import ContactForm from './pages/ContactForm.jsx';
import Login from './pages/Login.jsx';
import Inbox from './pages/Inbox.jsx';
import NotFound from './pages/NotFound.jsx';
import ProtectedRoute from './auth/ProtectedRoute.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/c/:agencySlug" element={<ContactForm />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/inbox"
        element={
          <ProtectedRoute>
            <Inbox />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
