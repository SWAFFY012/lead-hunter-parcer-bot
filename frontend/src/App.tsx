import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { ToastProvider } from './components/ToastProvider';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { Warmup } from './pages/Warmup';
import { ParserHub } from './pages/ParserHub';
import { ParserTelegram } from './pages/ParserTelegram';
import { ParserGoogleMaps } from './pages/ParserGoogleMaps';
import { ParserYandexMaps } from './pages/ParserYandexMaps';
import { Parser2Gis } from './pages/Parser2Gis';
import { ManualBases } from './pages/ManualBases';
import { Leads } from './pages/Leads';
import { Tasks } from './pages/Tasks';
import { Pipeline } from './pages/Pipeline';
import { AIMessages } from './pages/AIMessages';
import { Sender } from './pages/Sender';
import { Settings } from './pages/Settings';
import { Profiles } from './pages/Profiles';
import { SystemLogs } from './pages/SystemLogs';
import { GlobalAITracker } from './components/GlobalAITracker';
import './index.css';

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="app-layout">
          <Sidebar />
          <GlobalAITracker />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/warmup" element={<Warmup />} />
              <Route path="/parser" element={<ParserHub />} />
              <Route path="/parser/telegram" element={<ParserTelegram />} />
              <Route path="/parser/google-maps" element={<ParserGoogleMaps />} />
              <Route path="/parser/yandex-maps" element={<ParserYandexMaps />} />
              <Route path="/parser/2gis-maps" element={<Parser2Gis />} />
              <Route path="/manual-bases" element={<ManualBases />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/ai" element={<AIMessages />} />
              <Route path="/sender" element={<Sender />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/profiles" element={<Profiles />} />
              <Route path="/logs" element={<SystemLogs />} />
            </Routes>
          </main>
        </div>
      </ToastProvider>
    </BrowserRouter>
  );
}
