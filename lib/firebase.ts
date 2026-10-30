import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
  connectAuthEmulator,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { reportEmulatorsAllowed } from "./firebase-emulator-policy";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
);

type FirebaseServices = {
  auth: Auth;
  db: Firestore;
  persistenceReady: Promise<void>;
};

let services: FirebaseServices | null = null;

export function getFirebaseServices(): FirebaseServices {
  if (!firebaseConfigured) {
    throw new Error(
      "A configuração do Firebase ainda não foi informada nas variáveis NEXT_PUBLIC_FIREBASE_*.",
    );
  }
  if (services) return services;

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (process.env.NEXT_PUBLIC_REPORTS_EMULATORS === "true") {
    if (typeof window === "undefined" || !reportEmulatorsAllowed(process.env.NEXT_PUBLIC_REPORTS_EMULATORS, firebaseConfig.projectId, window.location.hostname)) {
      throw new Error("Demonstração permitida apenas em localhost e no projeto demo-client-reports.");
    }
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  services = {
    auth,
    db,
    persistenceReady: setPersistence(auth, browserLocalPersistence),
  };
  return services;
}
