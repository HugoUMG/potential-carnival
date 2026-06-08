import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { getCurrentSession } from '../services/api';
import type { UsuarioSesion } from '../services/api';

interface Props {
  allowedRoles: UsuarioSesion['role'][];
  children: ReactNode;
}

function roleRoute(role: UsuarioSesion['role']): string {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  if (role === 'reader') return '/reader';
  return '/student';
}

/**
 * Valida que exista sesión activa y que el rol coincida con los permitidos.
 * - Sin sesión → redirige a /login
 * - Rol incorrecto → redirige al portal correspondiente al rol real del usuario
 */
export function ProtectedRoute({ allowedRoles, children }: Props) {
  const session = getCurrentSession();

  if (!session) return <Navigate to="/login" replace />;

  if (!allowedRoles.includes(session.role)) {
    return <Navigate to={roleRoute(session.role)} replace />;
  }

  return <>{children}</>;
}
