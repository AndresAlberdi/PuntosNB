import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBgYjBNBZWeoujy-GMui-qHY8SZ34lZUPw",
  authDomain: "puntosnb.firebaseapp.com",
  projectId: "puntosnb",
  storageBucket: "puntosnb.firebasestorage.app",
  messagingSenderId: "636899046414",
  appId: "1:636899046414:web:9cfbfa0eccffa7ac71f85f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth
export const auth = getAuth(app);

// Initialize Firestore
export const db = getFirestore(app);

export default app;
