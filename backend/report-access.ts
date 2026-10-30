import {getApps,initializeApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {isCorporateEmail} from '../lib/auth-policy.ts';
import type {ReportClientId} from '../lib/client-reports/types.ts';
export function adminDb(){if(!getApps().length)initializeApp();return getFirestore();}
export async function assertReportAccess(uid:string,clientId?:ReportClientId):Promise<{uid:string;displayName:string}>{
 if(!uid)throw new Error('Autenticação obrigatória.');const db=adminDb();const [user,profile]=await Promise.all([getAuth().getUser(uid),db.doc(`users/${uid}`).get()]);
 if(user.disabled||!user.emailVerified||!isCorporateEmail(user.email)||profile.data()?.active!==true)throw new Error('Usuário não autorizado para relatórios.');
 if(clientId&&!['demo13','demo24','demo08','demo09','demo14','demo02','demo01'].includes(clientId))throw new Error('Cliente inválido.');
 return {uid,displayName:profile.data()?.displayName||user.displayName||user.email!};
}
