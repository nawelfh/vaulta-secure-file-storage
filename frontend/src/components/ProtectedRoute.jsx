import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import { LoadingScreen } from './LoadingScreen.jsx';

export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  return user ? children : <Navigate to="/login" replace />;
}
