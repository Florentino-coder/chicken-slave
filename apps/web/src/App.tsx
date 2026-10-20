import { useEffect, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { connect, ensureGuest } from './net';
import { useStore } from './store';
import Home from './pages/Home';
import RoomPage from './pages/RoomPage';
import Toasts from './components/Toasts';
import { useT } from './i18n';

export default function App() {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const roomCode = useStore((s) => s.room?.code ?? null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    ensureGuest()
      .then(() => {
        connect();
        setReady(true);
      })
      .catch(() => setFailed(true));
  }, []);

  // Follow the server: whenever we are seated in a room, show it.
  useEffect(() => {
    if (roomCode && location.pathname !== `/r/${roomCode}`) navigate(`/r/${roomCode}`, { replace: true });
  }, [roomCode, location.pathname, navigate]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="panel p-6">
          <p className="mb-4">{t('app.connectFailed')}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            {t('app.retry')}
          </button>
        </div>
      </div>
    );
  }
  if (!ready) return <div className="flex h-full items-center justify-center opacity-70">{t('app.loading')}</div>;

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/r/:code" element={<RoomPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <Toasts />
    </>
  );
}
