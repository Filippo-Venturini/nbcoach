// URL pubblico dell'app, usato per i link di invito/reset inviati ai clienti.
// I clienti devono aprire SEMPRE la produzione, mai localhost: per questo
// impostiamo VITE_APP_URL (su Netlify e in .env.local) al dominio pubblico.
// Fallback a window.location.origin se la variabile non è impostata.
export const APP_URL = import.meta.env.VITE_APP_URL || window.location.origin
