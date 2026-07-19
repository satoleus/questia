import { NavLink } from 'react-router-dom';
import { Home, PenSquare, ScrollText, BarChart3, User, Dices } from 'lucide-react';

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      <NavLink to="/timeline" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <ScrollText />
        <span>タイムライン</span>
      </NavLink>
      <NavLink to="/record" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <div className="nav-record-btn">
          <PenSquare />
        </div>
        <span>記録</span>
      </NavLink>
      <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Home />
        <span>ホーム</span>
      </NavLink>
      <NavLink to="/report" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <BarChart3 />
        <span>レポート</span>
      </NavLink>
      <NavLink to="/gacha" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <Dices />
        <span>ガチャ</span>
      </NavLink>
      <NavLink to="/mypage" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <User />
        <span>マイページ</span>
      </NavLink>
    </nav>
  );
}
