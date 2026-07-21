export const isStaging = import.meta.env.VITE_FIREBASE_PROJECT_ID === 'puntosnb' || import.meta.env.MODE === 'staging';
export const APP_TITLE = isStaging ? 'Hipatia (pruebas)' : 'Hipatia';
