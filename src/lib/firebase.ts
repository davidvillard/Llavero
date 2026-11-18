import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore/lite'

const env = import.meta.env
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
}

export const firebaseConfigured = Object.values(config).every(Boolean)

// Con valores de relleno si falta la configuración; la app muestra un aviso y no lo usa.
const app = initializeApp(firebaseConfigured ? config : { apiKey: 'missing', projectId: 'demo-llavero' })
export const auth = getAuth(app)
export const db = getFirestore(app)

// Solo para probar en local con `npx firebase-tools emulators:start`.
if (env.DEV && env.VITE_FIREBASE_EMULATOR === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
