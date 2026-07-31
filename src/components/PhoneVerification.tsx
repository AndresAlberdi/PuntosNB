import React, { useState, useEffect } from 'react';
import { RecaptchaVerifier, linkWithPhoneNumber } from 'firebase/auth';
import type { ConfirmationResult } from 'firebase/auth';
import { auth } from '../firebase';
import { Phone, AlertCircle } from 'lucide-react';

// Declaration to extend window object for recaptchaVerifier
declare global {
  interface Window {
    recaptchaVerifier: any;
  }
}

interface PhoneVerificationProps {
  onVerified: (telefono: string) => void;
  onCancel?: () => void;
}

export const PhoneVerification: React.FC<PhoneVerificationProps> = ({ onVerified, onCancel }) => {
  const [countryCode, setCountryCode] = useState('+591'); // Default Bolivia
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input_phone' | 'input_code'>('input_phone');

  useEffect(() => {
    // Inicializar Recaptcha
    if (!window.recaptchaVerifier) {
      try {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          'size': 'invisible',
          'callback': (_response: any) => {
            // reCAPTCHA solved
          }
        });
      } catch (err) {
        console.error("Error initializing recaptcha", err);
      }
    }
  }, []);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) {
      setError('Por favor ingresa un número de teléfono válido.');
      return;
    }
    setError('');
    setLoading(true);

    const fullPhoneNumber = `${countryCode}${phoneNumber}`;
    try {
      const appVerifier = window.recaptchaVerifier;
      if (!auth.currentUser) throw new Error("No hay usuario autenticado.");

      const confirmation = await linkWithPhoneNumber(auth.currentUser, fullPhoneNumber, appVerifier);
      setConfirmationResult(confirmation);
      setStep('input_code');
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/credential-already-in-use') {
        setError('Este número ya está en uso por otra cuenta.');
      } else if (err.code === 'auth/invalid-phone-number') {
        setError('El formato del número de teléfono es inválido.');
      } else {
        setError('Error al enviar SMS. Intenta nuevamente.');
      }
    }
    setLoading(false);
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode || !confirmationResult) return;
    
    setError('');
    setLoading(true);

    try {
      await confirmationResult.confirm(verificationCode);
      const fullPhoneNumber = `${countryCode}${phoneNumber}`;
      onVerified(fullPhoneNumber);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-verification-code') {
        setError('El código es incorrecto.');
      } else {
        setError('Error al verificar el código.');
      }
    }
    setLoading(false);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm max-w-md w-full mx-auto">
      <div className="flex justify-center mb-4">
        <div className="bg-blue-100 p-3 rounded-full text-blue-600">
          <Phone size={24} />
        </div>
      </div>
      <h2 className="text-xl font-semibold text-center mb-2">Verifica tu número de WhatsApp</h2>
      <p className="text-sm text-gray-600 text-center mb-6">
        Usaremos tu número telefónico solamente para temas relacionados con Hipatia Puntos y otros productos de Hipatia. No compartiremos tus datos con terceros. Esto también nos permitirá ayudarte a recuperar tu cuenta si la pierdes.
      </p>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded text-sm mb-4 flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {step === 'input_phone' ? (
        <form onSubmit={handleSendCode} className="space-y-4">
          <div className="flex gap-2">
            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              className="px-3 py-2 border rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
            >
              <option value="+54">🇦🇷 +54</option>
              <option value="+591">🇧🇴 +591</option>
              <option value="+55">🇧🇷 +55</option>
              <option value="+56">🇨🇱 +56</option>
              <option value="+57">🇨🇴 +57</option>
              <option value="+593">🇪🇨 +593</option>
              <option value="+34">🇪🇸 +34</option>
              <option value="+52">🇲🇽 +52</option>
              <option value="+51">🇵🇪 +51</option>
              <option value="+598">🇺🇾 +598</option>
              <option value="+1">🇺🇸 +1</option>
            </select>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
              placeholder="Ej: 71234567"
              className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          
          <div id="recaptcha-container"></div>
          
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? 'Enviando...' : 'Enviar código SMS'}
          </button>
          
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="w-full mt-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-md transition-colors"
            >
              Cancelar
            </button>
          )}
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="space-y-4">
          <p className="text-sm font-medium text-center">Ingresa el código de 6 dígitos enviado a {countryCode} {phoneNumber}</p>
          <input
            type="text"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            maxLength={6}
            className="w-full px-3 py-3 border rounded-md text-center text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <button
            type="submit"
            disabled={loading || verificationCode.length !== 6}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? 'Verificando...' : 'Verificar código'}
          </button>
          <button
            type="button"
            onClick={() => setStep('input_phone')}
            className="w-full text-blue-600 text-sm hover:underline"
          >
            Cambiar número de teléfono
          </button>
        </form>
      )}
    </div>
  );
};
