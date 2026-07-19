import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useUserStore } from './store/userStore';
import { hexToHsl, getContrastText } from './utils/theme';
import BottomNav from './components/BottomNav';
import Home from './pages/Home';
import Record from './pages/Record';
import Timeline from './pages/Timeline';
import Report from './pages/Report';
import MyPage from './pages/MyPage';
import Settings from './pages/Settings';
import Subjects from './pages/Subjects';
import Titles from './pages/Titles';
import EditTitles from './pages/EditTitles';
import Gacha from './pages/Gacha';
import LevelUpModal from './components/LevelUpModal';

function App() {
  const { theme, user } = useUserStore();
  const location = useLocation();
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [prevLevel, setPrevLevel] = useState(user.level);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    if (user.accentColor) {
      const hsl = hexToHsl(user.accentColor);
      const root = document.documentElement;
      root.style.setProperty('--theme-h', String(hsl.h));
      root.style.setProperty('--theme-s', `${hsl.s}%`);
      root.style.setProperty('--theme-l', `${hsl.l}%`);
      root.style.setProperty('--text-on-accent', getContrastText(user.accentColor));
    }
  }, [theme, user.accentColor]);

  useEffect(() => {
    if (user.level > prevLevel) {
      if (location.pathname !== '/record') {
        setShowLevelUp(true);
        setTimeout(() => setShowLevelUp(false), 3000);
      }
    }
    setPrevLevel(user.level);
  }, [user.level, prevLevel, location.pathname]);

  return (
    <div className="app-container">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/record" element={<Record />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/report" element={<Report />} />
        <Route path="/mypage" element={<MyPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/subjects" element={<Subjects />} />
        <Route path="/titles" element={<Titles />} />
        <Route path="/edit-titles" element={<EditTitles />} />
        <Route path="/gacha" element={<Gacha />} />
      </Routes>
      <BottomNav />
      {showLevelUp && (
        <LevelUpModal
          level={user.level}
          onClose={() => setShowLevelUp(false)}
        />
      )}
    </div>
  );
}

export default App;
