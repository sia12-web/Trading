import { redirect } from 'next/navigation';

export default function NotesRedirectPage() {
  redirect('/dashboard/edges');
}
