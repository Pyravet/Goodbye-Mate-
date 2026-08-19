import AppShell from '../layout/AppShell.jsx';
import Messaging from '@goodbye-mate/web-shared/src/Messaging.jsx';
import { makeConversationsApi } from '@goodbye-mate/web-shared/src/conversationsApi.js';
import { apiFetch } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

// Module scope: a new api object each render would give Messaging a
// fresh `api` identity and retrigger its loading effects in a loop.
const conversationsApi = makeConversationsApi(apiFetch);

export default function MessagesPage() {
  const { user } = useAuth();
  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Messages</h1>
        {/* Vets can't broadcast — they only ever message admin. */}
        <Messaging api={conversationsApi} currentUserId={user?.id} canBroadcast={false} />
      </div>
    </AppShell>
  );
}

const styles = {
  page: { padding: '20px 16px' },
  title: { fontSize: 22, marginBottom: 14 },
};
