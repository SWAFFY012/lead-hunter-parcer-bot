import { useState, useEffect } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ManualBases from './pages/ManualBases';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentTab, setCurrentTab] = useState<'instagram' | 'manual'>('instagram');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    const auth = localStorage.getItem('auth');
    if (auth === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-gray-50 relative">
      {/* Header with Hamburger */}
      <div className="h-14 bg-white border-b flex items-center justify-between px-4 shrink-0 shadow-sm relative z-50">
        <div className="font-bold text-lg text-emerald-600">LeadHunter</div>
        <button 
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2 -mr-2 text-gray-600 hover:text-emerald-600"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>

        {/* Dropdown Menu */}
        {isMenuOpen && (
          <div className="absolute top-14 right-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 animate-in fade-in slide-in-from-top-2">
            <button 
              onClick={() => { setCurrentTab('instagram'); setIsMenuOpen(false); }}
              className={`w-full text-left px-4 py-3 text-sm font-medium flex items-center gap-3 ${currentTab === 'instagram' ? 'text-emerald-600 bg-emerald-50' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              Instagram CRM
            </button>
            <button 
              onClick={() => { setCurrentTab('manual'); setIsMenuOpen(false); }}
              className={`w-full text-left px-4 py-3 text-sm font-medium flex items-center gap-3 ${currentTab === 'manual' ? 'text-emerald-600 bg-emerald-50' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              Ручные базы
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto" onClick={() => isMenuOpen && setIsMenuOpen(false)}>
        {currentTab === 'instagram' ? <Dashboard /> : <ManualBases />}
      </div>
    </div>
  );
}

export default App;
