import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Lead } from '../types';
import { Link, Send, Flame, RefreshCw, Copy, XCircle } from 'lucide-react';
import clsx from 'clsx';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<'fresh' | 'warmup' | 'ready' | 'sent'>('fresh');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<{id: number, name: string}[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [updatingLeadId, setUpdatingLeadId] = useState<number | null>(null);
  const [lastVisitedLeadId, setLastVisitedLeadId] = useState<number | null>(null);

  const fetchCampaigns = async () => {
    const { data } = await supabase.from('campaigns').select('id, name');
    if (data) setCampaigns(data);
  };

  const fetchLeads = async () => {
    setLoading(true);
    let query = supabase
      .from('leads')
      .select('*')
      .eq('platform', 'instagram')
      .in('status', ['new', 'ai_ready', 'ready_to_send', 'reaction_sent', 'message_sent'])
      .order('created_at', { ascending: false });
      
    if (selectedCampaignId !== 'all') {
      query = query.eq('campaign_id', selectedCampaignId);
    }
    
    const { data, error } = await query;
      
    if (!error && data) {
      setLeads(data as Lead[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [selectedCampaignId]);

  const handleUpdateStatus = async (id: number, newStatus: string) => {
    setUpdatingLeadId(id);
    try {
      const updateData: any = { status: newStatus };
      if (newStatus === 'reaction_sent') {
        updateData.reaction_timestamp = new Date().toISOString();
      }
      if (newStatus === 'message_sent') {
        updateData.last_contact_at = new Date().toISOString();
      }
      
      await supabase.from('leads').update(updateData).eq('id', id);
      await fetchLeads();
    } finally {
      setUpdatingLeadId(null);
    }
  };

  const copyToClipboard = async (text: string, leadId: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setLastVisitedLeadId(leadId);
      // No alert needed per user request
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const copyAndOpen = async (lead: Lead) => {
    try {
      if (lead.ai_message) {
        await navigator.clipboard.writeText(lead.ai_message);
      }
      setLastVisitedLeadId(lead.id);
      const url = lead.ig_username ? `instagram://user?username=${lead.ig_username}` : (lead.source_url ? lead.source_url.split(',')[0] : '#');
      window.open(url, '_blank');
    } catch (err) {
      console.error('Failed to copy and open', err);
    }
  };

  const freshLeads = leads.filter(l => ['new', 'ai_ready', 'ready_to_send'].includes(l.status));
  
  const warmupLeads = leads.filter(l => {
    if (l.status !== 'reaction_sent' || !l.reaction_timestamp) return false;
    const hoursPassed = (new Date().getTime() - new Date(l.reaction_timestamp).getTime()) / (1000 * 60 * 60);
    return hoursPassed < 24;
  });

  const readyLeads = leads.filter(l => {
    if (l.status !== 'reaction_sent' || !l.reaction_timestamp) return false;
    const hoursPassed = (new Date().getTime() - new Date(l.reaction_timestamp).getTime()) / (1000 * 60 * 60);
    return hoursPassed >= 24;
  });

  const sentLeads = leads.filter(l => l.status === 'message_sent');

  const totalParsed = leads.length;
  const totalAi = leads.filter(l => l.ai_message && l.ai_message.length > 5).length;

  const getRemainingTime = (timestamp: string) => {
    const msPassed = new Date().getTime() - new Date(timestamp).getTime();
    const msTotal = 24 * 60 * 60 * 1000;
    const msRemaining = msTotal - msPassed;
    if (msRemaining <= 0) return '0ч';
    const hours = Math.floor(msRemaining / (1000 * 60 * 60));
    const mins = Math.floor((msRemaining % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}ч ${mins}м`;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-900">LeadHunter</h1>
          <button onClick={fetchLeads} className="p-2 text-gray-500 hover:bg-gray-100 rounded-full">
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        
        <div className="px-4 pb-3">
          <select 
            value={selectedCampaignId} 
            onChange={(e) => setSelectedCampaignId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
          >
            <option value="all">Все базы Instagram</option>
            {campaigns.filter(c => c.name.toLowerCase().includes('insta') || c.name.toLowerCase().includes('инста')).map(camp => (
              <option key={camp.id} value={camp.id}>{camp.name}</option>
            ))}
          </select>
        </div>
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('fresh')}
            className={clsx("flex-1 py-3 text-xs font-medium text-center relative", activeTab === 'fresh' ? "text-blue-600" : "text-gray-500")}
          >
            Свежие ({freshLeads.length})
            {activeTab === 'fresh' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
          </button>
          <button
            onClick={() => setActiveTab('warmup')}
            className={clsx("flex-1 py-3 text-xs font-medium text-center relative", activeTab === 'warmup' ? "text-orange-500" : "text-gray-500")}
          >
            Прогрев ({warmupLeads.length})
            {activeTab === 'warmup' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />}
          </button>
          <button
            onClick={() => setActiveTab('ready')}
            className={clsx("flex-1 py-3 text-xs font-medium text-center relative", activeTab === 'ready' ? "text-green-600" : "text-gray-500")}
          >
            Готовы ({readyLeads.length})
            {activeTab === 'ready' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-600" />}
          </button>
          <button
            onClick={() => setActiveTab('sent')}
            className={clsx("flex-1 py-3 text-xs font-medium text-center relative", activeTab === 'sent' ? "text-purple-600" : "text-gray-500")}
          >
            Отпр. ({sentLeads.length})
            {activeTab === 'sent' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600" />}
          </button>
        </div>
        
        <div className="bg-gray-100 text-xs px-4 py-2 flex justify-between text-gray-600 shadow-inner">
          <span>Спарсено: <b>{totalParsed}</b></span>
          <span>ИИ: <b>{totalAi}</b></span>
          <span>Отправлено: <b>{sentLeads.length}</b></span>
        </div>
      </header>

      <main className="p-4 space-y-4">
        {loading && leads.length === 0 && (
          <div className="text-center py-10 text-gray-500">Загрузка...</div>
        )}

        {activeTab === 'fresh' && (
          freshLeads.length === 0 ? (
             <div className="text-center py-10 text-gray-400">Нет новых лидов</div>
          ) : (
            freshLeads.map(lead => (
              <div 
                key={lead.id} 
                className={`rounded-xl shadow-sm p-4 border transition-colors ${lastVisitedLeadId === lead.id ? 'bg-orange-50 border-orange-300' : 'bg-white border-gray-100'}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-gray-900">
                      {lead.ig_username ? `@${lead.ig_username}` : lead.phone}
                    </h3>
                    <p className="text-sm text-gray-500">{lead.name || (lead.platform === 'olx' ? 'OLX Лид' : 'Лид')}</p>
                  </div>
                  <a 
                    href={lead.ig_username ? `instagram://user?username=${lead.ig_username}` : (lead.source_url ? lead.source_url.split(',')[0] : '#')} 
                    onClick={() => setLastVisitedLeadId(lead.id)}
                    className="bg-pink-100 text-pink-600 p-2 rounded-full flex items-center justify-center"
                    target="_blank" rel="noreferrer"
                  >
                    <Link size={20} />
                  </a>
                </div>
                
                <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700 mb-4 h-24 overflow-y-auto">
                  {lead.ai_message || "Нет сгенерированного текста"}
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdateStatus(lead.id, 'not_lead')}
                    disabled={updatingLeadId === lead.id}
                    className="flex-1 flex items-center justify-center gap-1 bg-red-50 text-red-600 py-3 rounded-lg font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                  >
                    <XCircle size={18} />
                    Не лид
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(lead.id, 'reaction_sent')}
                    disabled={updatingLeadId === lead.id}
                    className="flex-[2] flex items-center justify-center gap-2 bg-blue-50 text-blue-600 py-3 rounded-lg font-medium hover:bg-blue-100 transition-colors disabled:opacity-50"
                  >
                    <Flame size={18} />
                    {updatingLeadId === lead.id ? 'Отправка...' : 'Отправил реакцию'}
                  </button>
                </div>
              </div>
            ))
          )
        )}

        {activeTab === 'warmup' && (
          warmupLeads.length === 0 ? (
             <div className="text-center py-10 text-gray-400">Нет лидов в прогреве</div>
          ) : (
            warmupLeads.map(lead => (
              <div key={lead.id} className="bg-white rounded-xl shadow-sm p-4 border border-gray-100 opacity-75">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-bold text-gray-900">
                    {lead.ig_username ? `@${lead.ig_username}` : lead.phone}
                  </h3>
                  <span className="text-xs font-medium bg-orange-100 text-orange-600 px-2 py-1 rounded-full">
                    Осталось: {getRemainingTime(lead.reaction_timestamp!)}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mb-3">Реакция отправлена: {new Date(lead.reaction_timestamp!).toLocaleString('ru-RU')}</p>
              </div>
            ))
          )
        )}

        {activeTab === 'ready' && (
          readyLeads.length === 0 ? (
             <div className="text-center py-10 text-gray-400">Нет готовых лидов</div>
          ) : (
            readyLeads.map(lead => (
              <div 
                key={lead.id} 
                className={`rounded-xl shadow-sm border-2 p-4 ${lastVisitedLeadId === lead.id ? 'border-orange-400 bg-orange-50' : 'border-green-100 bg-white'}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg">
                      {lead.ig_username ? `@${lead.ig_username}` : lead.phone}
                    </h3>
                    <p className="text-sm text-green-600 font-medium">Готов к отправке!</p>
                  </div>
                  <a 
                    href={lead.ig_username ? `instagram://user?username=${lead.ig_username}` : (lead.source_url ? lead.source_url.split(',')[0] : '#')} 
                    onClick={() => setLastVisitedLeadId(lead.id)}
                    className="bg-pink-100 text-pink-600 p-2 rounded-full flex items-center justify-center"
                    target="_blank" rel="noreferrer"
                  >
                    <Link size={20} />
                  </a>
                </div>
                
                <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-700 mb-4 cursor-pointer hover:bg-gray-100" onClick={() => copyToClipboard(lead.ai_message || '', lead.id)}>
                  {lead.ai_message || "Нет текста"}
                  <div className="text-center text-xs text-blue-500 mt-2 font-medium">Нажмите, чтобы скопировать текст</div>
                </div>

                <button
                  onClick={() => copyAndOpen(lead)}
                  className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white py-3 rounded-lg font-medium hover:bg-blue-600 transition-colors shadow-sm mb-3"
                >
                  <Copy size={18} />
                  Скопировать и открыть Инсту
                </button>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdateStatus(lead.id, 'not_lead')}
                    disabled={updatingLeadId === lead.id}
                    className="flex-1 flex items-center justify-center gap-1 bg-red-50 text-red-600 py-3 rounded-lg font-medium hover:bg-red-100 transition-colors shadow-sm disabled:opacity-50"
                  >
                    <XCircle size={18} />
                    Не лид
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(lead.id, 'message_sent')}
                    disabled={updatingLeadId === lead.id}
                    className="flex-[2] flex items-center justify-center gap-2 bg-green-500 text-white py-3 rounded-lg font-medium hover:bg-green-600 transition-colors shadow-sm disabled:opacity-50"
                  >
                    <Send size={18} />
                    {updatingLeadId === lead.id ? 'Отправка...' : 'Отправлено'}
                  </button>
                </div>
              </div>
            ))
          )
        )}

        {activeTab === 'sent' && (
          sentLeads.length === 0 ? (
             <div className="text-center py-10 text-gray-400">Нет отправленных сообщений</div>
          ) : (
            sentLeads.map(lead => (
              <div 
                key={lead.id} 
                className={`rounded-xl shadow-sm border-2 p-4 ${lastVisitedLeadId === lead.id ? 'border-purple-400 bg-purple-50' : 'border-gray-200 bg-gray-50'}`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg">
                      {lead.ig_username ? `@${lead.ig_username}` : lead.phone}
                    </h3>
                    <p className="text-sm text-purple-600 font-medium">Уже отправлено</p>
                  </div>
                  <a 
                    href={lead.ig_username ? `instagram://user?username=${lead.ig_username}` : (lead.source_url ? lead.source_url.split(',')[0] : '#')} 
                    onClick={() => setLastVisitedLeadId(lead.id)}
                    className="bg-gray-200 text-gray-600 p-2 rounded-full flex items-center justify-center"
                    target="_blank" rel="noreferrer"
                  >
                    <Link size={20} />
                  </a>
                </div>
                
                <div className="bg-white p-3 rounded-lg text-sm text-gray-700 mb-4 border">
                  {lead.ai_message || "Нет текста"}
                </div>
              </div>
            ))
          )
        )}
      </main>
    </div>
  );
}
