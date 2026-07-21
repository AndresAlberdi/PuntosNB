import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import Login from '../../pages/Login';
import * as firebaseAuth from 'firebase/auth';

// Mocks para Firebase
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

// Mock para el contexto (opcional, pero útil si se requiere estado inicial)
vi.mock('../../contexts/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/AuthContext')>();
  return {
    ...actual,
    useAuth: () => ({ currentUser: null, userData: null, loading: false }),
  };
});

// Helper component
const renderLogin = () => {
  return render(
    <BrowserRouter>
      <Login />
    </BrowserRouter>
  );
};

describe('Componente Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Debe renderizar el formulario correctamente', () => {
    renderLogin();
    
    // Verificar que los botones e inputs están presentes
    expect(screen.getByPlaceholderText('correo@ejemplo.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Iniciar Sesión/i })).toBeInTheDocument();
  });

  it('Debe manejar errores de inicio de sesión correctamente', async () => {
    // Simular error en firebase auth
    vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockRejectedValue(new Error('auth/invalid-credential'));
    
    renderLogin();
    const emailInput = screen.getByPlaceholderText('correo@ejemplo.com');
    const passwordInput = screen.getByPlaceholderText('••••••');
    const submitBtn = screen.getByRole('button', { name: /Iniciar Sesión/i });

    await userEvent.type(emailInput, 'test@example.com');
    await userEvent.type(passwordInput, 'wrongpassword');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Credenciales incorrectas/i)).toBeInTheDocument();
    });
  });
});
