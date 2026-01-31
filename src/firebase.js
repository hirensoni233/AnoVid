import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
    apiKey: "AIzaSyCexbrtJktNVoU0DdZR7CmZ90ms9Gjeq9k",
    authDomain: "studio-2640385913-be973.firebaseapp.com",
    projectId: "studio-2640385913-be973",
    storageBucket: "studio-2640385913-be973.firebasestorage.app",
    messagingSenderId: "1021815700948",
    appId: "1:1021815700948:web:3db88c02b77478d4a12a41"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
