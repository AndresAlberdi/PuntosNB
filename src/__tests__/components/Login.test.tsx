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
  fetchSignInMethodsForEmail: vi.fn().mockResolvedValue([]),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
}));

vi.mock('../../contexts/useAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/useAuth')>();
  return {
    ...actual,
    useAuth: () => ({ 
      currentUser: null, 
      userData: null, 
      loading: false,
      loginVendedor: vi.fn(),
      logout: vi.fn() 
    }),
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

  it('Debe renderizar el botón principal de Google y el botón de Ingreso con login', () => {
    renderLogin();
    
    expect(screen.getByRole('button', { name: /Continuar con Google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ingreso con login/i })).toBeInTheDocument();
  });

  it('Debe desplegar el formulario tradicional y manejar errores de autenticación', async () => {
    vi.mocked(firebaseAuth.signInWithEmailAndPassword).mockRejectedValue({ code: 'auth/invalid-credential' });
    
    renderLogin();

    // Clic en 'Ingreso con login'
    const toggleBtn = screen.getByRole('button', { name: /Ingreso con login/i });
    fireEvent.click(toggleBtn);

    const userInput = screen.getByPlaceholderText('ej: admin@comercio.io o usuario');
    const passwordInput = screen.getByPlaceholderText('••••••');
    const submitBtn = screen.getByRole('button', { name: /Iniciar Sesión/i });

    await userEvent.type(userInput, 'admin@mitienda.io');
    await userEvent.type(passwordInput, 'wrongpassword');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Usuario o contraseña incorrectos/i)).toBeInTheDocument();
    });
  });
});
