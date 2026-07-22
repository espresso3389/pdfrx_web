import { createRoot } from 'react-dom/client';
import { CollaborativePdfViewer } from '@pdfrx/colab';
import '@pdfrx/colab/styles.css';
import '@pdfrx/react/styles.css';
import './styles.css';

function CollaborationDemo() {
  const relayUrl = `ws://${location.hostname}:5191`;
  return (
    <main className="collab-app">
      <header className="collab-header">
        <div>
          <h1>pdfrx collaborative pages</h1>
          <p>ページ操作、PDF・画像の追加、アノテーションがrelay経由で共有されます。</p>
        </div>
        <span className="collab-session">session: demo</span>
      </header>
      <div className="collab-grid">
        <CollaborativePdfViewer name="Alice" actorId="alice" relayUrl={relayUrl} sessionId="demo" src="/hello.pdf" />
        <CollaborativePdfViewer name="Bob" actorId="bob" relayUrl={relayUrl} sessionId="demo" src="/hello.pdf" />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<CollaborationDemo />);
