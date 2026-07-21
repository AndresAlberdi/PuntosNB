export const isStaging = import.meta.env.VITE_FIREBASE_PROJECT_ID === 'puntosnb' || import.meta.env.MODE === 'staging';
export const APP_TITLE = isStaging ? 'Hipatia (pruebas)' : 'Hipatia';

export const SUPER_ADMIN_EMAILS = [
  'alberdi.andres@gmail.com',
  'nbruzonic@gmail.com',
  'hipatia.admin@gmail.com'
];

export const isSuperAdminEmail = (email?: string | null): boolean => {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.includes(email.toLowerCase().trim());
};
